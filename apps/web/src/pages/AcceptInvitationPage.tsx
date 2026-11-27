import type { InvitationResponse } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  Alert,
  Field,
  FieldValidationError,
  FullPageLoading,
  Input,
  SubmitButton,
} from "../components/ui";
import { AuthPageFrame } from "../components/shell/AuthFrame";
import { Button } from "../components/ui/button";
import { PasswordField } from "../components/ui/password-field";
import { authClient, authErrorMessage, sameEmail } from "../lib/auth-client";
import {
  acceptInvitation,
  fetchInvitation,
  invitationQueryKey,
} from "../lib/api/invitations";
import {
  fetchMeContext,
  ME_CONTEXT_QUERY_KEY,
  updateActiveOrganization,
} from "../lib/api/me";
import {
  clearInvitation,
  readInvitation,
  rememberInvitation,
} from "../lib/auth/continuation";
import { assertContextIdentity } from "../lib/tenant/bootstrap";
import { ApiError } from "../lib/api/client";
import { INVITATION_LIFETIME, type AuthFlowState } from "../lib/auth/flow";
import { formatDateTime, usePreferences } from "../lib/preferences";
import { ROLE_LABELS } from "../lib/roles";
import {
  claimContextPublication,
  createContextPublicationClaim,
  hasContextPublicationClaim,
  publishContextPublication,
} from "../lib/queryClient";

const textLink = "inline-flex min-h-6 items-center text-primary underline";

// The API answers 404 for unknown, expired, revoked and accepted invitations alike (it does not
// reveal which), so the message names expiry as one cause.
const INVITATION_NOT_FOUND_MESSAGE = `ไม่พบคำเชิญนี้ หรือคำเชิญหมดอายุแล้ว (ใช้ได้ ${INVITATION_LIFETIME}) กรุณาขอคำเชิญใหม่จากเจ้าของหรือผู้ดูแลองค์กร`;

function invitationProblemMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return INVITATION_NOT_FOUND_MESSAGE;
    }
    if (error.status === 410 || error.code === "INVITATION_EXPIRED") {
      return "คำเชิญหมดอายุแล้ว กรุณาขอคำเชิญใหม่จากเจ้าของหรือผู้ดูแลองค์กร";
    }
    if (error.status === 0) {
      return "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    }
  }
  return "โหลดข้อมูลคำเชิญไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}

// A 404 or 410 is final; a dropped connection, a server fault or an unknown failure may pass on a second try.
function previewFailure(error: unknown): { title: string; retryable: boolean } {
  const final =
    error instanceof ApiError && (error.status === 404 || error.status === 410);
  const transient =
    !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
  return {
    title: final ? "ไม่พบคำเชิญ" : "โหลดคำเชิญไม่สำเร็จ",
    retryable: transient,
  };
}

export function AcceptInvitationPage() {
  const { invitationId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = authClient.useSession();

  const preview = useQuery({
    queryKey: invitationQueryKey(invitationId),
    queryFn: () => fetchInvitation(invitationId),
    enabled: invitationId.length > 0,
    retry: false,
  });

  if (invitationId.length === 0 || preview.error !== null) {
    const failure = previewFailure(preview.error);
    const signedIn = session.data !== null;
    return (
      <AuthPageFrame
        data-testid="invitation-page"
        eyebrow="// invitation"
        title={failure.title}
      >
        <div className="flex flex-col gap-4">
          <Alert data-testid="invitation-preview-error" tone="error">
            {invitationProblemMessage(preview.error)}
          </Alert>
          {failure.retryable && preview.error !== null ? (
            <Button
              data-testid="invitation-preview-retry"
              type="button"
              className="w-full"
              disabled={preview.isFetching}
              onClick={() => {
                void preview.refetch();
              }}
            >
              {preview.isFetching ? "กำลังโหลด…" : "ลองใหม่"}
            </Button>
          ) : null}
          {signedIn ? (
            <Link
              data-testid="invitation-preview-workspace"
              to="/workspace"
              className={`${textLink} self-center text-sm`}
            >
              ไปที่พื้นที่ทำงาน
            </Link>
          ) : (
            <Link
              data-testid="invitation-login"
              to="/login"
              className={`${textLink} self-center text-sm`}
            >
              ไปที่หน้าเข้าสู่ระบบ
            </Link>
          )}
        </div>
      </AuthPageFrame>
    );
  }

  if (preview.isPending) {
    return (
      <FullPageLoading
        data-testid="invitation-loading"
        label="กำลังตรวจสอบคำเชิญ…"
      />
    );
  }

  const invitation = preview.data.invitation;
  const user = session.data?.user;

  if (user !== undefined) {
    if (!user.emailVerified) {
      return <UnverifiedInvitation invitation={invitation} />;
    }

    if (!sameEmail(user.email, invitation.email)) {
      return (
        <div className="break-words">
          <AuthPageFrame
            data-testid="invitation-wrong-account"
            subtitleTestId="invitation-recipient"
            eyebrow="// invitation"
            title="บัญชีนี้ไม่ตรงกับคำเชิญ"
            subtitle={`คำเชิญส่งถึง ${invitation.email} แต่คุณกำลังเข้าสู่ระบบด้วย ${user.email}`}
          >
            <div className="flex flex-col gap-4">
              <Alert tone="error">
                เข้าสู่ระบบด้วยอีเมลที่ได้รับคำเชิญ
                หรือออกจากระบบเพื่อสร้างบัญชีใหม่
              </Alert>
              <Button
                data-testid="invitation-sign-out"
                type="button"
                className="w-full"
                onClick={() => {
                  void authClient.signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        void navigate(0);
                      },
                    },
                  });
                }}
              >
                ออกจากระบบและใช้บัญชีอื่น
              </Button>
            </div>
          </AuthPageFrame>
        </div>
      );
    }

    return (
      <VerifiedAcceptance
        key={invitation.id}
        invitationId={invitation.id}
        organizationName={invitation.organizationName}
        role={invitation.role}
        expiresAt={invitation.expiresAt}
      />
    );
  }

  if (session.isPending) {
    return <FullPageLoading label="กำลังตรวจสอบเซสชัน…" />;
  }

  return (
    <SignupGate
      invitationId={invitation.id}
      email={invitation.email}
      organizationName={invitation.organizationName}
      role={invitation.role}
      expiresAt={invitation.expiresAt}
      onSignedUp={() => {
        queryClient.removeQueries({
          queryKey: invitationQueryKey(invitation.id),
        });
        void navigate("/verify-email", {
          state: {
            email: invitation.email,
            sent: true,
          } satisfies AuthFlowState,
        });
      }}
    />
  );
}

// The invitation is remembered in an effect, not while rendering, so a discarded render leaves no storage write.
function UnverifiedInvitation({
  invitation,
}: {
  invitation: InvitationResponse["invitation"];
}) {
  const navigate = useNavigate();
  useEffect(() => {
    rememberInvitation(invitation.id);
  }, [invitation.id]);
  return (
    <AuthPageFrame
      data-testid="invitation-unverified"
      subtitleTestId="invitation-recipient"
      eyebrow="// invitation"
      title="ยืนยันอีเมลก่อนเข้าร่วม"
      subtitle={`คำเชิญสำหรับ ${invitation.email} กรุณายืนยันอีเมลของบัญชีนี้ก่อนรับคำเชิญ`}
    >
      <div className="flex flex-col gap-4">
        <Alert tone="info">
          บัญชีนี้ยังไม่ได้ยืนยันอีเมล ตรวจอีเมลของคุณหรือขอลิงก์ใหม่
        </Alert>
        <Button
          data-testid="invitation-verify-email"
          type="button"
          className="w-full"
          onClick={() => {
            void navigate("/verify-email");
          }}
        >
          ไปที่หน้ายืนยันอีเมล
        </Button>
      </div>
    </AuthPageFrame>
  );
}

// The API answers 404 for an invitation past `expiresAt`, so say until when the link works.
function InvitationExpiry({ expiresAt }: { expiresAt: string }) {
  const { preferences } = usePreferences();
  return (
    <p className="text-sm text-foreground-secondary">
      คำเชิญใช้ได้ถึง{" "}
      <time data-testid="invitation-expires-at" dateTime={expiresAt}>
        {formatDateTime(new Date(expiresAt), preferences)}
      </time>
    </p>
  );
}

function VerifiedAcceptance({
  invitationId,
  organizationName,
  role,
  expiresAt,
}: {
  invitationId: string;
  organizationName: string;
  role: string;
  expiresAt: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const pendingRef = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isMounted = () => mounted.current;
  useEffect(() => {
    if (error !== null) errorRef.current?.focus();
  }, [error]);

  async function accept() {
    if (pendingRef.current || accepted) return;
    setError(null);
    pendingRef.current = true;
    setPending(true);
    let joined = false;
    try {
      const { organizationId } = await acceptInvitation(invitationId);
      joined = true;
      if (readInvitation() === invitationId) clearInvitation();
      if (!isMounted()) return;
      setAccepted(true);
      const claim = createContextPublicationClaim();
      if (!claimContextPublication(queryClient, claim, "bootstrap")) return;
      await queryClient.cancelQueries({
        queryKey: ME_CONTEXT_QUERY_KEY,
        exact: true,
      });
      if (!isMounted() || !hasContextPublicationClaim(queryClient, claim))
        return;
      const context = await fetchMeContext();
      assertContextIdentity(queryClient, context);
      if (!isMounted() || !hasContextPublicationClaim(queryClient, claim))
        return;
      if (!context.organizations.some((org) => org.id === organizationId)) {
        throw new Error("Accepted membership is missing from context");
      }
      const updated = await updateActiveOrganization({ organizationId });
      assertContextIdentity(queryClient, updated);
      if (!isMounted() || !hasContextPublicationClaim(queryClient, claim))
        return;
      await queryClient.cancelQueries({ queryKey: ["tenant"] });
      if (!isMounted() || !hasContextPublicationClaim(queryClient, claim))
        return;
      queryClient.removeQueries({ queryKey: ["tenant"] });
      publishContextPublication(queryClient, claim, updated);
      void navigate("/workspace", { replace: true });
    } catch (cause) {
      if (!isMounted()) return;
      setError(
        cause instanceof ApiError &&
          cause.code === "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED"
          ? "องค์กรมีสมาชิกครบ 1,000 คนแล้ว คำเชิญยังรอตอบรับ กรุณาติดต่อเจ้าของหรือผู้ดูแลองค์กร"
          : cause instanceof ApiError && cause.status === 404
            ? INVITATION_NOT_FOUND_MESSAGE
            : joined
              ? "เข้าร่วมองค์กรแล้ว แต่เลือกองค์กรไม่สำเร็จ กรุณาไปที่พื้นที่ทำงาน"
              : "รับคำเชิญไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      );
    } finally {
      if (isMounted()) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }
  return (
    <AuthPageFrame
      data-testid="invitation-accept-page"
      subtitleTestId="invitation-organization"
      eyebrow="// invitation"
      title="ยอมรับคำเชิญ"
      subtitle={`คุณได้รับเชิญให้เข้าร่วมองค์กร ${organizationName} ในบทบาท${ROLE_LABELS[role] ?? role}`}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void accept();
        }}
        className="flex flex-col gap-4"
      >
        {error === null ? null : (
          <div
            data-testid="invitation-accept-error-focus"
            ref={errorRef}
            tabIndex={-1}
            className="outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Alert data-testid="invitation-accept-error" tone="error">
              {error}
            </Alert>
          </div>
        )}
        {accepted ? null : <InvitationExpiry expiresAt={expiresAt} />}
        {accepted ? (
          <Link
            data-testid="invitation-workspace"
            to="/workspace"
            className={`${textLink} self-center`}
          >
            ไปที่พื้นที่ทำงาน
          </Link>
        ) : (
          <Button
            data-testid="invitation-accept"
            type="submit"
            className="w-full"
            disabled={pending}
          >
            {pending ? "กำลังเข้าร่วม…" : "เข้าร่วมองค์กร"}
          </Button>
        )}
      </form>
    </AuthPageFrame>
  );
}

function SignupGate({
  invitationId,
  email,
  organizationName,
  role,
  expiresAt,
  onSignedUp,
}: {
  invitationId: string;
  email: string;
  organizationName: string;
  role: string;
  expiresAt: string;
  onSignedUp: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const expired = new Date(expiresAt).getTime() <= Date.now();

  const form = useForm({
    defaultValues: {
      name: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      rememberInvitation(invitationId);
      try {
        const { error: signUpError } = await authClient.signUp.email(
          {
            name: value.name.trim(),
            email,
            password: value.password,
            // The server forwards invitationId into the verification link so a new-tab verification can resume it.
            callbackURL: `/onboarding?invitationId=${invitationId}`,
          },
          // Fetch options: the header must ride the real request for the server-side invitation gate.
          { headers: { "X-Invitation-ID": invitationId } },
        );
        if (signUpError != null) {
          setError(authErrorMessage(signUpError, "สร้างบัญชีไม่สำเร็จ"));
          return;
        }
        onSignedUp();
      } catch {
        setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
      }
    },
  });

  return (
    <AuthPageFrame
      data-testid="invitation-signup-page"
      subtitleTestId="invitation-organization"
      eyebrow="// invitation"
      title="สร้างบัญชีจากคำเชิญ"
      subtitle={`คุณได้รับเชิญให้เข้าร่วมองค์กร ${organizationName} ในบทบาท${ROLE_LABELS[role] ?? role}`}
    >
      {expired ? (
        <div className="flex flex-col gap-4">
          <Alert data-testid="invitation-expired" tone="error">
            คำเชิญหมดอายุแล้ว กรุณาขอคำเชิญใหม่จากเจ้าของหรือผู้ดูแลองค์กร
          </Alert>
          <Link
            data-testid="invitation-login"
            to="/login"
            className={`${textLink} self-center text-sm`}
          >
            ไปที่หน้าเข้าสู่ระบบ
          </Link>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          {error === null ? null : (
            <Alert data-testid="invitation-signup-error" tone="error">
              {error}
            </Alert>
          )}
          <InvitationExpiry expiresAt={expiresAt} />
          <Field label="อีเมล (ตามคำเชิญ)">
            <Input
              data-testid="invitation-signup-email"
              type="email"
              name="email"
              value={email}
              readOnly
              aria-readonly="true"
              className="text-foreground-secondary"
            />
          </Field>
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) =>
                value.trim().length >= 2
                  ? undefined
                  : "ชื่อต้องมีอย่างน้อย 2 ตัวอักษร",
              onSubmit: ({ value }) =>
                value.trim().length >= 2
                  ? undefined
                  : "ชื่อต้องมีอย่างน้อย 2 ตัวอักษร",
            }}
          >
            {(field) => (
              <Field htmlFor="invitation-signup-name" label="ชื่อที่แสดง">
                <Input
                  id="invitation-signup-name"
                  data-testid="invitation-signup-name"
                  type="text"
                  name="name"
                  autoComplete="name"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={
                    field.state.meta.errors.length > 0
                      ? "invitation-name-error"
                      : undefined
                  }
                />
                <FieldValidationError
                  id="invitation-name-error"
                  data-testid="invitation-name-error"
                  errors={field.state.meta.errors}
                />
              </Field>
            )}
          </form.Field>
          <form.Field
            name="password"
            validators={{
              onChange: ({ value }) =>
                value.length >= 8
                  ? undefined
                  : "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร",
              onSubmit: ({ value }) =>
                value.length >= 8
                  ? undefined
                  : "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร",
            }}
          >
            {(field) => (
              <PasswordField
                id="invitation-signup-password"
                label="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)"
                name="password"
                autoComplete="new-password"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                errors={field.state.meta.errors}
              />
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => state.isSubmitting}
            children={(isSubmitting) => (
              <SubmitButton
                data-testid="invitation-signup-submit"
                pending={isSubmitting}
                pendingLabel="กำลังสร้างบัญชี…"
              >
                สร้างบัญชีและรอการยืนยันอีเมล
              </SubmitButton>
            )}
          />
          <p className="text-center text-sm text-foreground-secondary">
            มีบัญชีอยู่แล้ว?{" "}
            <Link
              data-testid="invitation-login"
              to="/login"
              className={textLink}
              onClick={() => {
                rememberInvitation(invitationId);
              }}
            >
              เข้าสู่ระบบเพื่อรับคำเชิญ
            </Link>
          </p>
        </form>
      )}
    </AuthPageFrame>
  );
}
