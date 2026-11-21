import {
  awsConnectionTestFailedErrorResponseSchema,
  awsRoleArnSchema,
  awsTestRateLimitedErrorResponseSchema,
  type OrganizationAwsConnectionResponse,
  type OrganizationAwsConnectionTestResponse,
} from "@nightwatch/api-contract";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Alert, Field, Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Notice } from "../../components/ui/notice";
import { StatusPill } from "../../components/ui/status-pill";
import { ApiError } from "../../lib/api/client";
import {
  disconnectOrganizationAwsConnection,
  saveOrganizationAwsConnection,
  testOrganizationAwsConnection,
} from "../../lib/api/aws-connection";
import { formatDateTime, usePreferences } from "../../lib/preferences";
import { CopyButton } from "./CopyButton";
import {
  FAILURE_REASONS,
  ROLE_ARN_FORMAT_ERROR,
  type DeniedCode,
} from "./labels";

type Action = "test" | "save";

// `tested` remembers the ARN and revision it ran against: a result counts only
// while both still match the form and the loaded data (AC-04).
type Attempt =
  | { kind: "idle" }
  | { kind: "testing"; roleArn: string }
  | {
      kind: "tested";
      roleArn: string;
      revision: number;
      result: OrganizationAwsConnectionTestResponse;
    }
  | { kind: "saving"; roleArn: string }
  | { kind: "saved" }
  | { kind: "error"; action: Action; roleArn: string; message: string };

const testFailedDetails =
  awsConnectionTestFailedErrorResponseSchema.shape.error.shape.details;
const rateLimitedDetails =
  awsTestRateLimitedErrorResponseSchema.shape.error.shape.details;

export function ConnectionCard({
  organizationId,
  data,
  onUpdated,
  onDenied,
  onReload,
}: {
  organizationId: string;
  data: OrganizationAwsConnectionResponse;
  onUpdated: (next: OrganizationAwsConnectionResponse) => void;
  onDenied: (code: DeniedCode) => void;
  onReload: () => void;
}) {
  const { preferences } = usePreferences();
  const connection = data.connection;
  const [editing, setEditing] = useState(false);
  const [roleArn, setRoleArn] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt>({ kind: "idle" });
  const [conflict, setConflict] = useState(false);
  const [disconnect, setDisconnect] = useState<{
    opener: HTMLElement | null;
    pending: boolean;
    error: string | null;
  } | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  // The revision a draft started from, or was last tested against; another
  // request moving it past that point gets a notice (AC-11).
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  // Every request takes a ticket; editing the ARN or leaving the page voids it,
  // so a late answer never replaces what the form now shows (AC-11).
  const ticket = useRef(0);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const hintId = useId();
  const errorId = useId();

  useEffect(
    () => () => {
      ticket.current += 1;
    },
    [],
  );
  // Runs after the dialog's own focus return, whose opener left with the
  // connection, so focus lands on the card instead of the body (AC-13).
  useEffect(() => {
    if (disconnected) heading.current?.focus();
  }, [disconnected]);

  // A draft keeps the form open when the data changes under it (a reload
  // after 409 or a background refetch); only Save or Cancel closes it.
  const formOpen = editing || roleArn !== "" || connection === null;
  const pending = attempt.kind === "testing" || attempt.kind === "saving";
  const passed =
    attempt.kind === "tested" &&
    attempt.result.result === "passed" &&
    attempt.roleArn === roleArn &&
    attempt.revision === data.revision;

  function begin(next: Attempt): number | null {
    if (busy.current) return null;
    busy.current = true;
    ticket.current += 1;
    setConflict(false);
    setDisconnected(false);
    setAttempt(next);
    return ticket.current;
  }

  function settle(id: number): boolean {
    if (id !== ticket.current) return false;
    busy.current = false;
    return true;
  }

  function fail(error: unknown, action: Action, arn: string) {
    if (!(error instanceof ApiError)) throw error;
    switch (error.code) {
      case "PERMISSION_DENIED":
      case "MEMBERSHIP_DENIED":
        onDenied(error.code);
        return;
      case "AWS_CONNECTION_REVISION_CONFLICT":
        setConflict(true);
        setAttempt({ kind: "idle" });
        return;
      case "AWS_ROLE_ARN_INVALID":
        setFieldError(ROLE_ARN_FORMAT_ERROR);
        setAttempt({ kind: "idle" });
        input.current?.focus();
        return;
      case "AWS_CONNECTION_TEST_FAILED": {
        const details = testFailedDetails.safeParse(error.details);
        setAttempt({
          kind: "tested",
          roleArn: arn,
          revision: data.revision,
          result: {
            result: "failed",
            code: details.success ? details.data.code : "AWS_UNKNOWN",
          },
        });
        return;
      }
    }
    const retryAfter = rateLimitedDetails.safeParse(error.details);
    setAttempt({
      kind: "error",
      action,
      roleArn: arn,
      message:
        error.code === "AWS_TEST_RATE_LIMITED" && retryAfter.success
          ? `ทดสอบบ่อยเกินกำหนด ลองใหม่ได้ในอีก ${retryAfter.data.retryAfterSeconds.toString()} วินาที ค่าที่บันทึกไว้ยังไม่เปลี่ยน`
          : error.code === "RATE_LIMIT_UNAVAILABLE"
            ? "บริการทดสอบการเชื่อมต่อไม่พร้อมใช้งานชั่วคราว ค่าที่บันทึกไว้ยังไม่เปลี่ยน ลองใหม่ภายหลัง"
            : action === "test"
              ? "ทดสอบไม่สำเร็จ ลองใหม่อีกครั้ง"
              : "บันทึกไม่สำเร็จ ค่าที่บันทึกไว้ยังไม่เปลี่ยน ลองใหม่อีกครั้ง",
    });
  }

  async function runTest(arn: string) {
    if (!awsRoleArnSchema.safeParse(arn).success) {
      setFieldError(ROLE_ARN_FORMAT_ERROR);
      input.current?.focus();
      return;
    }
    setFieldError(null);
    const id = begin({ kind: "testing", roleArn: arn });
    if (id === null) return;
    const revision = data.revision;
    if (formOpen) setDraftRevision(revision);
    try {
      const result = await testOrganizationAwsConnection(organizationId, {
        roleArn: arn,
        revision,
      });
      if (settle(id))
        setAttempt({ kind: "tested", roleArn: arn, revision, result });
    } catch (error) {
      if (settle(id)) fail(error, "test", arn);
    }
  }

  async function runSave(arn: string) {
    const id = begin({ kind: "saving", roleArn: arn });
    if (id === null) return;
    try {
      const next = await saveOrganizationAwsConnection(organizationId, {
        roleArn: arn,
        revision: data.revision,
      });
      if (!settle(id)) return;
      onUpdated(next);
      setEditing(false);
      setRoleArn("");
      setDraftRevision(null);
      setAttempt({ kind: "saved" });
      heading.current?.focus();
    } catch (error) {
      if (settle(id)) fail(error, "save", arn);
    }
  }

  async function confirmDisconnect() {
    if (disconnect === null || disconnect.pending) return;
    setDisconnect({ ...disconnect, pending: true, error: null });
    const id = ++ticket.current;
    try {
      const next = await disconnectOrganizationAwsConnection(
        organizationId,
        data.revision,
      );
      if (id !== ticket.current) return;
      onUpdated(next);
      setDisconnect(null);
      setAttempt({ kind: "idle" });
      setEditing(false);
      setRoleArn("");
      setDraftRevision(null);
      setDisconnected(true);
    } catch (error) {
      if (id !== ticket.current) return;
      if (!(error instanceof ApiError)) throw error;
      if (
        error.code === "PERMISSION_DENIED" ||
        error.code === "MEMBERSHIP_DENIED"
      ) {
        onDenied(error.code);
        return;
      }
      if (error.code === "AWS_CONNECTION_REVISION_CONFLICT") {
        setDisconnect(null);
        setConflict(true);
        return;
      }
      setDisconnect({
        opener: disconnect.opener,
        pending: false,
        error:
          "ยกเลิกการเชื่อมต่อไม่สำเร็จ ค่าที่บันทึกไว้ยังไม่เปลี่ยน ลองใหม่อีกครั้ง",
      });
    }
  }

  function changeRoleArn(value: string) {
    setRoleArn(value);
    setFieldError(null);
    setDraftRevision((current) =>
      value === "" ? null : (current ?? data.revision),
    );
    // A pending test, its result or a failed request (with its retry) all
    // belong to the old value.
    if (
      attempt.kind === "testing" ||
      attempt.kind === "tested" ||
      attempt.kind === "error"
    ) {
      ticket.current += 1;
      busy.current = false;
      setAttempt({ kind: "idle" });
    }
  }

  function startEditing() {
    setEditing(true);
    setRoleArn(connection?.roleArn ?? "");
    setDraftRevision(data.revision);
    setAttempt({ kind: "idle" });
    setDisconnected(false);
  }

  function cancelEditing() {
    ticket.current += 1;
    busy.current = false;
    setEditing(false);
    setRoleArn("");
    setDraftRevision(null);
    setFieldError(null);
    setAttempt({ kind: "idle" });
  }

  const affected = data.projects.length;
  const shownResult =
    attempt.kind === "tested" &&
    attempt.roleArn === (formOpen ? roleArn : connection.roleArn)
      ? attempt
      : null;
  // A passed result tested before the change already says it is stale; the
  // 409 notice asks for a reload.
  const draftOutdated =
    roleArn !== "" &&
    draftRevision !== null &&
    draftRevision !== data.revision &&
    !conflict &&
    !pending &&
    shownResult?.result.result !== "passed";
  const hasMessages =
    conflict ||
    draftOutdated ||
    disconnected ||
    shownResult !== null ||
    (attempt.kind !== "idle" && attempt.kind !== "tested");

  return (
    <Card
      as="section"
      data-testid="aws-connection-card"
      aria-labelledby="aws-connection-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6 pb-4">
        <h2
          id="aws-connection-title"
          ref={heading}
          tabIndex={-1}
          className="w-fit rounded-[4px] text-base font-semibold text-heading outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          บัญชี AWS กลางขององค์กร
        </h2>
        {connection === null ? (
          <StatusPill data-testid="aws-connection-status" tone="muted" dot>
            ยังไม่เชื่อมต่อ
          </StatusPill>
        ) : (
          <StatusPill data-testid="aws-connection-status" tone="primary" dot>
            เชื่อมต่อแล้ว
          </StatusPill>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-6 pb-6 sm:grid-cols-2">
        {connection === null ? null : (
          <>
            <Detail label="Account ID" mono testId="aws-connection-account">
              {connection.accountId}
            </Detail>
            <Detail label="วิธีเชื่อมต่อ">Assume role จาก NightWatch</Detail>
            <Detail label="Role ARN" mono testId="aws-connection-role-arn">
              {connection.roleArn}
            </Detail>
          </>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-[13px] text-foreground-secondary">External ID</dt>
          <dd className="flex min-w-0 items-center gap-2">
            <span
              data-testid="aws-external-id"
              className="font-mono text-[13px] break-all"
            >
              {data.externalId}
            </span>
            <CopyButton
              value={data.externalId}
              label="คัดลอก External ID"
              copiedLabel="คัดลอก External ID แล้ว"
              data-testid="aws-external-id-copy"
            />
          </dd>
        </div>
        {connection === null ? null : (
          <>
            <Detail label="ทดสอบล่าสุด" testId="aws-connection-tested">
              <span className="font-mono text-[13px]">
                {formatDateTime(new Date(connection.testedAt), preferences)}
              </span>{" "}
              · ผ่าน
            </Detail>
            <Detail label="ตั้งค่าโดย">
              {connection.updatedBy?.name ?? "ผู้ใช้ที่ไม่ได้เป็นสมาชิกแล้ว"}
            </Detail>
          </>
        )}
      </dl>

      <div className={`flex flex-col gap-4 px-6 ${hasMessages ? "pb-6" : ""}`}>
        {conflict ? (
          <div
            data-testid="aws-connection-conflict"
            className="flex flex-col gap-3"
          >
            <Alert tone="warning">
              การเชื่อมต่อ AWS ถูกแก้ไขจากคำขออื่น
              โหลดข้อมูลล่าสุดก่อนดำเนินการต่อ ค่าที่คุณกรอกยังอยู่
            </Alert>
            <div>
              <Button
                data-testid="aws-connection-reload"
                type="button"
                variant="secondary"
                onClick={() => {
                  setConflict(false);
                  onReload();
                }}
              >
                โหลดข้อมูลล่าสุด
              </Button>
            </div>
          </div>
        ) : null}
        {attempt.kind === "error" ? (
          <div
            data-testid="aws-connection-request-error"
            className="flex flex-col gap-3"
          >
            <Alert tone="error">{attempt.message}</Alert>
            <div>
              <Button
                data-testid="aws-connection-retry"
                type="button"
                variant="secondary"
                onClick={() => {
                  void (attempt.action === "test"
                    ? runTest(attempt.roleArn)
                    : runSave(attempt.roleArn));
                }}
              >
                ลองใหม่
              </Button>
            </div>
          </div>
        ) : null}
        {/* One polite region carries every test, save and disconnect outcome (AC-13). */}
        <div data-testid="aws-connection-result" role="status">
          {attempt.kind === "testing" ? (
            <Notice tone="pending">กำลังทดสอบการเชื่อมต่อ…</Notice>
          ) : null}
          {attempt.kind === "saving" ? (
            <Notice tone="pending">กำลังทดสอบซ้ำและบันทึก…</Notice>
          ) : null}
          {attempt.kind === "saved" ? (
            <Notice data-testid="aws-connection-saved" tone="success">
              บันทึกการเชื่อมต่อแล้ว
            </Notice>
          ) : null}
          {disconnected ? (
            <Notice data-testid="aws-connection-disconnected" tone="success">
              ยกเลิกการเชื่อมต่อแล้ว External ID ยังเป็นค่าเดิม
            </Notice>
          ) : null}
          {draftOutdated ? (
            <p
              data-testid="aws-connection-changed"
              className="text-sm text-caution"
            >
              การเชื่อมต่อ AWS เพิ่งถูกแก้ไขจากคำขออื่น
              ข้อมูลด้านบนเป็นค่าล่าสุดแล้ว ตรวจ Role ARN ที่คุณกรอกก่อนทดสอบ
            </p>
          ) : null}
          {shownResult === null ? null : (
            <TestResult
              result={shownResult.result}
              saved={!formOpen}
              stale={shownResult.revision !== data.revision}
            />
          )}
        </div>
      </div>

      {formOpen ? (
        <form
          data-testid="aws-connection-form"
          noValidate
          className="flex flex-col gap-4 border-t border-foreground/10 px-6 py-6"
          onSubmit={(event) => {
            event.preventDefault();
            void runTest(roleArn);
          }}
        >
          <Field
            label="Role ARN ในบัญชีกลาง"
            error={fieldError}
            errorId={errorId}
            errorTestId="aws-role-arn-error"
          >
            <Input
              ref={input}
              data-testid="aws-role-arn"
              value={roleArn}
              disabled={attempt.kind === "saving"}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-[13px]"
              placeholder="arn:aws:iam::111122223333:role/NightWatchOrgHub"
              aria-invalid={fieldError === null ? undefined : true}
              aria-describedby={
                fieldError === null ? hintId : `${errorId} ${hintId}`
              }
              onChange={(event) => {
                changeRoleArn(event.target.value);
              }}
            />
          </Field>
          <p
            id={hintId}
            className="-mt-2 text-[13px] text-foreground-secondary"
          >
            ทดสอบให้ผ่านก่อนบันทึก ตอนบันทึก NightWatch จะทดสอบซ้ำอีกครั้ง
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {connection === null ? null : (
              <Button
                data-testid="aws-connection-cancel-edit"
                type="button"
                variant="ghost"
                disabled={attempt.kind === "saving"}
                onClick={cancelEditing}
              >
                ยกเลิกการแก้ไข
              </Button>
            )}
            <Button
              data-testid="aws-connection-test"
              type="submit"
              variant="secondary"
              disabled={pending}
            >
              {attempt.kind === "testing" ? "กำลังทดสอบ…" : "ทดสอบการเชื่อมต่อ"}
            </Button>
            <Button
              data-testid="aws-connection-save"
              type="button"
              disabled={!passed || pending}
              onClick={() => {
                if (passed) void runSave(roleArn);
              }}
            >
              {attempt.kind === "saving" ? "กำลังบันทึก…" : "บันทึก"}
            </Button>
          </div>
        </form>
      ) : null}

      {connection === null || formOpen ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 px-6 pt-4 pb-6">
          <span className="text-[13px] text-foreground-secondary">
            ยกเลิกการเชื่อมต่อแล้ว{" "}
            <span className="font-mono">{affected.toString()}</span>{" "}
            โปรเจกต์ด้านล่างจะดึงข้อมูลจาก AWS ไม่ได้
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="aws-connection-disconnect"
              type="button"
              variant="destructive-outline"
              disabled={pending}
              onClick={(event) => {
                setDisconnect({
                  opener: event.currentTarget,
                  pending: false,
                  error: null,
                });
              }}
            >
              ยกเลิกการเชื่อมต่อ
            </Button>
            <Button
              data-testid="aws-connection-edit"
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={startEditing}
            >
              แก้ไข
            </Button>
            <Button
              data-testid="aws-connection-retest"
              type="button"
              disabled={pending}
              onClick={() => {
                void runTest(connection.roleArn);
              }}
            >
              {attempt.kind === "testing" ? "กำลังทดสอบ…" : "ทดสอบอีกครั้ง"}
            </Button>
          </div>
        </div>
      )}

      {disconnect === null ? null : (
        <ConfirmDialog
          data-testid="aws-disconnect-dialog"
          confirmTestId="aws-disconnect-confirm"
          title="ยกเลิกการเชื่อมต่อบัญชี AWS กลาง"
          description={
            <div className="flex flex-col gap-3">
              <p data-testid="aws-disconnect-impact">
                โปรเจกต์ที่ใช้บัญชีกลาง{" "}
                <span className="font-mono text-foreground">
                  {affected.toString()}
                </span>{" "}
                โปรเจกต์จะดึงข้อมูลจาก AWS ไม่ได้
                จนกว่าจะตั้งค่าบัญชีกลางและทดสอบใหม่ การตั้งค่าของโปรเจกต์และ
                External ID ยังคงอยู่ โปรเจกต์ที่ใช้ access key
                ของตัวเองไม่ได้รับผลกระทบ
              </p>
              {disconnect.error === null ? null : (
                <Alert data-testid="aws-disconnect-error" tone="error">
                  {disconnect.error}
                </Alert>
              )}
            </div>
          }
          confirmLabel="ยกเลิกการเชื่อมต่อ"
          cancelLabel="ไม่ยกเลิก"
          confirmVariant="destructive"
          pendingLabel="กำลังยกเลิกการเชื่อมต่อ…"
          pending={disconnect.pending}
          opener={disconnect.opener}
          fallbackFocus={heading}
          onCancel={() => {
            setDisconnect(null);
          }}
          onConfirm={() => {
            void confirmDisconnect();
          }}
        />
      )}
    </Card>
  );
}

function Detail({
  label,
  mono = false,
  testId,
  children,
}: {
  label: string;
  mono?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[13px] text-foreground-secondary">{label}</dt>
      <dd
        data-testid={testId}
        className={mono ? "font-mono text-[13px] break-all" : undefined}
      >
        {children}
      </dd>
    </div>
  );
}

// A passed test of an unsaved value uses Caution and says so (AC-10); the
// written label carries the state, never the colour alone (AC-13).
function TestResult({
  result,
  saved,
  stale,
}: {
  result: OrganizationAwsConnectionTestResponse;
  saved: boolean;
  stale: boolean;
}) {
  if (result.result === "failed") {
    return (
      <div
        data-testid="aws-test-failed"
        className="flex flex-col items-start gap-1"
      >
        <StatusPill tone="danger" dot>
          ทดสอบไม่ผ่าน
        </StatusPill>
        <p data-testid="aws-test-reason" className="text-sm text-foreground">
          {FAILURE_REASONS[result.code]}
        </p>
      </div>
    );
  }
  return (
    <div
      data-testid="aws-test-passed"
      className="flex flex-col items-start gap-1"
    >
      <StatusPill tone={saved ? "primary" : "caution"} dot>
        {saved ? "ทดสอบผ่าน" : "ทดสอบผ่าน · ยังไม่บันทึก"}
      </StatusPill>
      <p className="text-sm text-foreground-secondary">
        AWS ยืนยันบัญชี{" "}
        <span
          data-testid="aws-test-account"
          className="font-mono text-[13px] text-foreground"
        >
          {result.accountId}
        </span>{" "}
        ตัวตน{" "}
        <span
          data-testid="aws-test-arn"
          className="font-mono text-[13px] break-all text-foreground"
        >
          {result.arn}
        </span>
      </p>
      {stale ? (
        <p className="text-sm text-caution">
          ผลนี้ทดสอบกับข้อมูลก่อนโหลดใหม่ ทดสอบอีกครั้งก่อนบันทึก
        </p>
      ) : saved ? null : (
        <p className="text-sm text-foreground-secondary">
          ผลนี้ยืนยันตัวตนจาก AWS STS ณ ตอนทดสอบเท่านั้น
          ยังไม่ใช่การเชื่อมต่อที่บันทึก
        </p>
      )}
    </div>
  );
}
