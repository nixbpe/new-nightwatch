import { awsRoleArnSchema, type AwsTestResult } from "@nightwatch/api-contract";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Input } from "../../components/ui/input";
import { ApiError } from "../../lib/api/client";

type Failed = Extract<AwsTestResult, { ok: false }>["code"];
const failures: Record<Failed, string> = {
  AWS_ACCESS_DENIED:
    "AWS ไม่อนุญาต โปรดตรวจสอบตัวตน สิทธิ์ และนโยบายความเชื่อถือ",
  AWS_ACCOUNT_MISMATCH: "บัญชีที่ AWS ยืนยันไม่ตรงกับบัญชีใน Role ARN",
  AWS_REGION_DISABLED: "Region นี้ใช้ทดสอบไม่ได้",
  AWS_TIMEOUT: "AWS ไม่ตอบภายในเวลา โปรดลองใหม่",
  AWS_UNKNOWN: "ทดสอบการเชื่อมต่อ AWS ไม่สำเร็จ โปรดลองใหม่",
};

export function awsRequestError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403 || error.status === 404)
      return "คุณเข้าถึงการเชื่อมต่อนี้ไม่ได้";
    if (error.code === "AWS_CONNECTION_CHANGED")
      return "การตั้งค่าเปลี่ยนแล้ว โปรดโหลดใหม่";
    if (error.code === "AWS_HUB_REQUIRED")
      return "ตั้งค่าบัญชีกลางขององค์กรก่อน";
    if (error.status === 429) return "ทดสอบบ่อยเกินไป โปรดลองใหม่ภายหลัง";
    if (error.status === 503) return "บริการทดสอบการเชื่อมต่อยังไม่พร้อม";
  }
  return "ทำรายการไม่สำเร็จ โปรดลองใหม่";
}

export function CopyValue({ label, value }: { label: string; value: string }) {
  const [message, setMessage] = useState("");
  return (
    <div className="min-w-0 space-y-2">
      <p>{label}</p>
      <pre className="whitespace-pre-wrap break-all text-sm">{value}</pre>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setMessage("");
          void navigator.clipboard.writeText(value).then(
            () => {
              setMessage("คัดลอกแล้ว");
            },
            () => {
              setMessage("คัดลอกไม่ได้");
            },
          );
        }}
      >
        คัดลอก {label}
      </Button>
      <span role="status">{message}</span>
    </div>
  );
}

type State =
  | { phase: "idle" | "testing" | "saving" | "saved" | "disconnecting" }
  | { phase: "tested"; result: AwsTestResult }
  | { phase: "error"; message: string };

export function AwsConnectionForm({
  initialRoleArn,
  canTest = true,
  saved,
  affected,
  check,
  disconnect,
  changed,
}: {
  initialRoleArn: string | null;
  canTest?: boolean;
  saved: boolean;
  affected: ReactNode;
  check: (
    roleArn: string,
    save: boolean,
    signal: AbortSignal,
  ) => Promise<AwsTestResult>;
  disconnect: (signal: AbortSignal) => Promise<unknown>;
  changed: () => Promise<unknown>;
}) {
  const [roleArn, setRoleArn] = useState(initialRoleArn ?? "");
  const [state, setState] = useState<State>({ phase: "idle" });
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);
  const fallback = useRef<HTMLInputElement>(null);
  const flight = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      flight.current?.abort();
    },
    [],
  );
  const busy =
    state.phase === "testing" ||
    state.phase === "saving" ||
    state.phase === "disconnecting";
  const valid = awsRoleArnSchema.safeParse(roleArn).success;
  const canSave = state.phase === "tested" && state.result.ok;
  async function run(action: "test" | "save" | "disconnect") {
    if (
      flight.current ||
      (action !== "disconnect" && (!canTest || !valid)) ||
      (action === "save" && !canSave)
    )
      return;
    const abort = new AbortController();
    flight.current = abort;
    setState({
      phase:
        action === "test"
          ? "testing"
          : action === "save"
            ? "saving"
            : "disconnecting",
    });
    try {
      if (action === "disconnect") {
        await disconnect(abort.signal);
        if (abort.signal.aborted) return;
        setOpener(null);
        setRoleArn("");
        setState({ phase: "idle" });
        await changed();
      } else {
        const result = await check(roleArn, action === "save", abort.signal);
        if (abort.signal.aborted) return;
        if (action === "save" && result.ok) {
          setState({ phase: "saved" });
          await changed();
        } else setState({ phase: "tested", result });
      }
    } catch (error) {
      if (!abort.signal.aborted)
        setState({ phase: "error", message: awsRequestError(error) });
    } finally {
      flight.current = null;
    }
  }
  return (
    <div className="space-y-3">
      <label className="block">
        Role ARN
        <Input
          ref={fallback}
          value={roleArn}
          disabled={busy || !canTest}
          spellCheck={false}
          data-testid="aws-role-arn"
          aria-invalid={roleArn.length > 0 && !valid}
          aria-describedby="aws-role-format"
          onChange={(event) => {
            setRoleArn(event.target.value);
            setState({ phase: "idle" });
          }}
        />
      </label>
      <p id="aws-role-format" className="text-sm text-muted-foreground">
        รูปแบบ: arn:aws:iam::123456789012:role/NightWatchRole
      </p>
      {state.phase === "tested" &&
        (state.result.ok ? (
          <Alert tone="warning" role="status" data-testid="aws-test-passed">
            ทดสอบผ่าน · ยังไม่บันทึก{" "}
            <span>
              {state.result.accountId} · {state.result.arn}
            </span>
          </Alert>
        ) : (
          <Alert tone="error" role="alert" data-testid="aws-test-failed">
            {failures[state.result.code]}
          </Alert>
        ))}
      {state.phase === "error" && (
        <Alert tone="error" role="alert">
          {state.message}
        </Alert>
      )}
      {state.phase === "saved" && (
        <p role="status" data-testid="aws-saved">
          บันทึกการเชื่อมต่อแล้ว
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {saved && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={(event) => {
              setOpener(event.currentTarget);
            }}
          >
            ยกเลิกการเชื่อมต่อ
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          data-testid="aws-test"
          disabled={busy || !valid || !canTest}
          onClick={() => void run("test")}
        >
          {state.phase === "testing" ? "กำลังทดสอบ…" : "ทดสอบ"}
        </Button>
        <Button
          type="button"
          data-testid="aws-save"
          disabled={busy || !canSave}
          onClick={() => void run("save")}
        >
          {state.phase === "saving" ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
      </div>
      {opener && (
        <ConfirmDialog
          title="ยกเลิกการเชื่อมต่อ AWS"
          description={affected}
          confirmLabel="ยืนยันการยกเลิก"
          confirmVariant="destructive"
          pendingLabel="กำลังยกเลิก…"
          pending={state.phase === "disconnecting"}
          opener={opener}
          fallbackFocus={fallback}
          onCancel={() => {
            setOpener(null);
          }}
          onConfirm={() => void run("disconnect")}
        />
      )}
    </div>
  );
}
