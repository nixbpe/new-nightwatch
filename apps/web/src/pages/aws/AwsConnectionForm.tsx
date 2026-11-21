import {
  awsProjectAccessKeySchema,
  awsRoleArnSchema,
  type AwsProjectInput,
  type AwsTestResult,
} from "@nightwatch/api-contract";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Input } from "../../components/ui/input";
import { isAwsAccessDenied } from "../../lib/api/aws";
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
      return "การตั้งค่าถูกแก้ไขจากคำขออื่น โหลดข้อมูลล่าสุดแล้ว ตรวจค่าที่กรอกแล้วทดสอบอีกครั้ง";
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
  revision,
  canTest = true,
  saved,
  affected,
  check,
  disconnect,
  changed,
  onDenied,
  access,
  disconnectFocus,
}: {
  initialRoleArn: string | null;
  /** Settings revision of the loaded data; enables the concurrent-change notice (AC-11). */
  revision?: string;
  onDenied?: () => void;
  disconnectFocus?: RefObject<HTMLElement | null>;
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
  access?: {
    region: string;
    check: (
      draft: Extract<AwsProjectInput, { method: "access_key" }>,
      save: boolean,
      signal: AbortSignal,
    ) => Promise<AwsTestResult>;
  };
}) {
  const [roleArn, setRoleArn] = useState(initialRoleArn ?? "");
  const [keyDraft, setKeyDraft] = useState({
    method: "access_key" as const,
    accessKeyId: "",
    secretAccessKey: "",
    region: access?.region ?? "us-east-1",
  });
  const [state, setState] = useState<State>({ phase: "idle" });
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);
  const fallback = useRef<HTMLDivElement>(null);
  const disconnected = useRef(false);
  const preferFallback = useCallback(() => disconnected.current, []);
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
  const valid = access
    ? awsProjectAccessKeySchema.safeParse(keyDraft).success
    : awsRoleArnSchema.safeParse(roleArn).success;
  // `base` is the revision the draft and its test belong to (AC-11). When the
  // loaded revision moves, an untouched form (including one just saved or
  // disconnected) takes the new value silently; over a draft, a test result
  // or a pending request, the change is announced.
  const [edited, setEdited] = useState(false);
  const dirty = edited || busy || state.phase === "tested";
  const [base, setBase] = useState(revision);
  useEffect(() => {
    if (revision === base || dirty) return;
    setBase(revision);
    setRoleArn(initialRoleArn ?? "");
  }, [dirty, revision, base, initialRoleArn]);
  const outdated = revision !== base && dirty && !busy;
  const canSave = state.phase === "tested" && state.result.ok && !outdated;
  async function run(action: "test" | "save" | "disconnect") {
    if (
      flight.current ||
      (action !== "disconnect" && (!canTest || !valid)) ||
      (action === "save" && !canSave)
    )
      return;
    const abort = new AbortController();
    flight.current = abort;
    setBase(revision);
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
        if (!abort.signal.aborted) {
          disconnected.current = true;
          await changed();
        }
        if (abort.signal.aborted) return;
        setOpener(null);
        setEdited(false);
        setRoleArn("");
        setKeyDraft({ ...keyDraft, accessKeyId: "", secretAccessKey: "" });
        setState({ phase: "idle" });
      } else {
        const result = await (access
          ? access.check(keyDraft, action === "save", abort.signal)
          : check(roleArn, action === "save", abort.signal));
        if (abort.signal.aborted) return;
        if (action === "save" && result.ok) {
          setKeyDraft({ ...keyDraft, accessKeyId: "", secretAccessKey: "" });
          setEdited(false);
          setState({ phase: "saved" });
          await changed();
        } else setState({ phase: "tested", result });
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      setState({ phase: "error", message: awsRequestError(error) });
      if (
        error instanceof ApiError &&
        error.code === "AWS_CONNECTION_CHANGED"
      ) {
        // The reload below shows the new value; the dialog would otherwise
        // disconnect it straight away. Its opener may leave with the
        // connection, so focus returns to the form (AC-13).
        disconnected.current = true;
        setOpener(null);
        void changed();
      } else if (isAwsAccessDenied(error)) onDenied?.();
    } finally {
      flight.current = null;
    }
  }
  return (
    <div
      className="space-y-3"
      tabIndex={-1}
      ref={fallback}
      aria-label="ตั้งค่าการเชื่อมต่อ AWS"
    >
      {access ? (
        (
          [
            ["accessKeyId", "Access key ID"],
            ["secretAccessKey", "Secret access key"],
            ["region", "Region"],
          ] as const
        ).map(([field, label]) => (
          <label className="block" key={field}>
            {label}
            <Input
              type={field === "secretAccessKey" ? "password" : "text"}
              data-testid={`aws-${field}`}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              value={keyDraft[field]}
              onChange={(event) => {
                setKeyDraft({ ...keyDraft, [field]: event.target.value });
                setState({ phase: "idle" });
              }}
            />
          </label>
        ))
      ) : (
        <>
          <label className="block">
            Role ARN
            <Input
              value={roleArn}
              disabled={busy || !canTest}
              spellCheck={false}
              data-testid="aws-role-arn"
              aria-invalid={roleArn.length > 0 && !valid}
              aria-describedby={
                roleArn.length > 0 && !valid
                  ? "aws-role-error aws-role-format"
                  : "aws-role-format"
              }
              onChange={(event) => {
                setRoleArn(event.target.value);
                setEdited(true);
                setState({ phase: "idle" });
              }}
            />
          </label>
          {roleArn.length > 0 && !valid && (
            <p
              id="aws-role-error"
              data-testid="aws-role-arn-error"
              className="text-sm text-danger"
            >
              Role ARN ไม่ถูกรูปแบบ
            </p>
          )}
          <p id="aws-role-format" className="text-sm text-muted-foreground">
            รูปแบบ: arn:aws:iam::123456789012:role/NightWatchRole
          </p>
        </>
      )}
      <p
        role="status"
        data-testid="aws-connection-changed"
        className="text-sm text-caution"
      >
        {outdated &&
          state.phase !== "error" &&
          "การตั้งค่าถูกแก้ไขจากคำขออื่น ข้อมูลด้านบนเป็นค่าล่าสุดแล้ว ตรวจค่าที่กรอกแล้วทดสอบอีกครั้งก่อนบันทึก"}
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
      {state.phase === "error" && !opener && (
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
              disconnected.current = false;
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
          description={
            <>
              {affected}
              {state.phase === "error" && (
                <Alert tone="error" role="alert">
                  {state.message}
                </Alert>
              )}
            </>
          }
          confirmLabel="ยืนยันการยกเลิก"
          confirmVariant="destructive"
          pendingLabel="กำลังยกเลิก…"
          pending={state.phase === "disconnecting"}
          opener={opener}
          fallbackFocus={disconnectFocus ?? fallback}
          preferFallbackFocus={preferFallback}
          onCancel={() => {
            setOpener(null);
          }}
          onConfirm={() => void run("disconnect")}
        />
      )}
    </div>
  );
}
