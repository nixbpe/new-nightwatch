import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  Alert,
  AuthPageShell,
  Field,
  FieldValidationError,
  FullPageLoading,
  Input,
  SubmitButton,
} from "../components/ui";
import { authClient, authErrorMessage, sameEmail } from "../lib/auth-client";
import { fetchInvitation, invitationQueryKey } from "../lib/api/invitations";
import { ME_CONTEXT_QUERY_KEY } from "../lib/api/me";
import { clearInvitation, rememberInvitation } from "../lib/auth/continuation";
import { ApiError } from "../lib/api/client";
import { ROLE_LABELS } from "../lib/roles";

function invitationProblemMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "ไม่พบคำเชิญนี้ ตรวจสอบลิงก์จากอีเมลอีกครั้งหรือติดต่อผู้เชิญ";
    }
    if (error.status === 410 || error.code === "INVITATION_EXPIRED") {
      return "คำเชิญหมดอายุแล้ว กรุณาขอคำเชิญใหม่จากผู้ดูแลองค์กร";
    }
    if (error.status === 0) {
      return "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    }
  }
  return "โหลดข้อมูลคำเชิญไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
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
    return (
      <AuthPageShell title="คำเชิญ">
        <div className="flex flex-col gap-4">
          <Alert tone="error">{invitationProblemMessage(preview.error)}</Alert>
          <Link to="/login" className="text-sm text-primary underline">
            ไปที่หน้าเข้าสู่ระบบ
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  if (preview.isPending) {
    return <FullPageLoading label="กำลังตรวจสอบคำเชิญ…" />;
  }

  const invitation = preview.data.invitation;
  const user = session.data?.user;

  if (user !== undefined) {
    if (!user.emailVerified) {
      rememberInvitation(invitation.id);
      return (
        <AuthPageShell
          title="ยืนยันอีเมลก่อนเข้าร่วม"
          subtitle={`คำเชิญสำหรับ ${invitation.email} — กรุณายืนยันอีเมลของบัญชีนี้ก่อนรับคำเชิญ`}
        >
          <div className="flex flex-col gap-4">
            <Alert tone="info">
              เราส่งลิงก์ยืนยันไปที่อีเมลของคุณแล้ว
              คำเชิญจะรอการยอมรับหลังยืนยันสำเร็จ
            </Alert>
            <button
              type="button"
              className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={() => {
                void navigate("/verify-email");
              }}
            >
              ไปที่หน้ายืนยันอีเมล
            </button>
          </div>
        </AuthPageShell>
      );
    }

    if (!sameEmail(user.email, invitation.email)) {
      return (
        <AuthPageShell
          title="บัญชีนี้ไม่ตรงกับคำเชิญ"
          subtitle={`คำเชิญส่งถึง ${invitation.email} แต่คุณกำลังเข้าสู่ระบบด้วย ${user.email}`}
        >
          <div className="flex flex-col gap-4">
            <Alert tone="error">
              เข้าสู่ระบบด้วยอีเมลที่ได้รับคำเชิญ
              หรือออกจากระบบเพื่อสร้างบัญชีใหม่
            </Alert>
            <button
              type="button"
              className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
            </button>
          </div>
        </AuthPageShell>
      );
    }

    return (
      <VerifiedAcceptance
        invitationId={invitation.id}
        organizationName={invitation.organizationName}
        role={invitation.role}
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
        void navigate("/verify-email");
      }}
    />
  );
}

function VerifiedAcceptance({
  invitationId,
  organizationName,
  role,
}: {
  invitationId: string;
  organizationName: string;
  role: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function accept() {
    if (pending) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      const { error: acceptError } =
        await authClient.organization.acceptInvitation({ invitationId });
      if (acceptError != null) {
        setError(authErrorMessage(acceptError, "รับคำเชิญไม่สำเร็จ"));
        return;
      }
      clearInvitation();
      await queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
      void navigate("/workspace", { replace: true });
    } catch {
      setError("เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthPageShell
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
        {error === null ? null : <Alert tone="error">{error}</Alert>}
        <SubmitButton pending={pending} pendingLabel="กำลังเข้าร่วม…">
          เข้าร่วมองค์กร
        </SubmitButton>
      </form>
    </AuthPageShell>
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
            // The server forwards this invitationId into the emailed
            // verification link so a new-tab verification can resume it.
            callbackURL: `/onboarding?invitationId=${invitationId}`,
          },
          // Second argument is the fetch-options object itself: the header
          // must ride the real request for the server-side invitation gate.
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
    <AuthPageShell
      title="สร้างบัญชีจากคำเชิญ"
      subtitle={`คุณได้รับเชิญให้เข้าร่วมองค์กร ${organizationName} ในบทบาท${ROLE_LABELS[role] ?? role}`}
    >
      {expired ? (
        <Alert tone="error">
          คำเชิญหมดอายุแล้ว กรุณาขอคำเชิญใหม่จากผู้ดูแลองค์กร
        </Alert>
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
          {error === null ? null : <Alert tone="error">{error}</Alert>}
          <Field label="อีเมล (ตามคำเชิญ)">
            <Input
              type="email"
              name="email"
              value={email}
              readOnly
              aria-readonly="true"
              className="opacity-70"
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
              <Field label="ชื่อที่แสดง">
                <Input
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
              <Field label="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)">
                <Input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={
                    field.state.meta.errors.length > 0
                      ? "invitation-password-error"
                      : undefined
                  }
                />
                <FieldValidationError
                  id="invitation-password-error"
                  errors={field.state.meta.errors}
                />
              </Field>
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => state.isSubmitting}
            children={(isSubmitting) => (
              <SubmitButton
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
              to="/login"
              className="text-primary underline"
              onClick={() => {
                rememberInvitation(invitationId);
              }}
            >
              เข้าสู่ระบบเพื่อรับคำเชิญ
            </Link>
          </p>
        </form>
      )}
      {expired ? (
        <Link
          to="/login"
          className="mt-4 block text-center text-sm text-primary underline"
        >
          ไปที่หน้าเข้าสู่ระบบ
        </Link>
      ) : null}
    </AuthPageShell>
  );
}
