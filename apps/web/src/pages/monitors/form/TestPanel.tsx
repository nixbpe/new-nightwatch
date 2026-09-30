import type { MonitorTestResult } from "@nightwatch/api-contract";
import { useEffect, useRef, useState } from "react";

import { Alert } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { Card, CardHeader } from "../../../components/ui/card";
import { ApiError } from "../../../lib/api/client";
import {
  AssertionTable,
  assertionRowFromResult,
  type AssertionRow,
} from "../detail/AssertionTable";
import { EVALUATED_FROM_PREFIX_TEXT, tlsFailureText } from "../detail/labels";
import { formatNumber } from "../format";
import { SslLabel } from "../SslLabel";
import { URL_BLOCKED_MESSAGE, type TestSnapshot } from "./model";

type TestPayload = TestSnapshot;

const IDLE_TEXT =
  "ยังไม่ได้ทดสอบ ผลการทดสอบไม่ถูกบันทึกและไม่ส่งผลต่อมอนิเตอร์";

// A target-side failure is worded as the target's result. `check_error` is
// NightWatch's own failure and never reads as one.
function failureText(result: MonitorTestResult, timeoutSeconds: number) {
  switch (result.failureReason) {
    case "http_status":
      return "รหัสสถานะไม่อยู่ในที่คาดหวัง";
    case "timeout":
      return `หมดเวลารอ ${String(timeoutSeconds)} วินาที ไม่ได้รับการตอบกลับ`;
    case "dns_not_found":
      return "ไม่พบชื่อโดเมนนี้";
    case "connect_refused":
      return "ปลายทางปฏิเสธการเชื่อมต่อ";
    case "connect_failed":
      return "เชื่อมต่อปลายทางไม่สำเร็จ";
    case "tls_invalid":
      return tlsFailureText(result.tlsReason);
    case "blocked_address":
      return URL_BLOCKED_MESSAGE;
    case "redirect_blocked":
      return "ที่อยู่ปลายทางของ redirect ไม่อนุญาตให้ตรวจสอบ";
    case "redirect_limit":
      return "redirect เกินกำหนด";
    case "body_read_failed":
      return "อ่านเนื้อหาตอบกลับไม่สำเร็จ";
    default:
      return null;
  }
}

function headline(result: MonitorTestResult, timeoutSeconds: number): string {
  if (result.outcome === "pass") return "การทดสอบผ่าน";
  if (result.outcome === "check_error") {
    return "ตรวจไม่ได้ (ปัญหาฝั่งระบบ) ไม่ใช่ผลของเป้าหมาย ลองอีกครั้ง";
  }
  if (result.failureReason === "assertion_failed") {
    const failed = result.assertions.filter(
      (item) => item.status === "fail",
    ).length;
    return `ไม่ผ่าน: ${String(failed)} จาก ${String(result.assertions.length)} เงื่อนไข`;
  }
  return `ไม่ผ่าน: ${failureText(result, timeoutSeconds) ?? "ตรวจไม่ผ่าน"}`;
}

function statusRow(
  result: MonitorTestResult,
  expectedStatus: string,
): AssertionRow {
  const evaluated = result.httpStatus !== null;
  return {
    key: "status",
    label: "รหัสสถานะ",
    expected: expectedStatus,
    actual: evaluated ? String(result.httpStatus) : null,
    truncated: false,
    status: !evaluated
      ? "not_evaluated"
      : result.failureReason === "http_status"
        ? "fail"
        : "pass",
    reason: evaluated ? null : "ไม่มี response",
  };
}

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "result"; result: MonitorTestResult; sent: TestPayload }
  | { kind: "rateLimited"; until: number }
  | { kind: "serviceError" };

function retryAfterOf(error: ApiError): number | null {
  const details = error.details;
  if (typeof details !== "object" || details === null) return null;
  const seconds = (details as { retryAfterSeconds?: unknown })
    .retryAfterSeconds;
  return typeof seconds === "number" && seconds >= 1 ? seconds : null;
}

/**
 * The Test box (feature.md, Test Configuration). One request at a time: the
 * button stays focused and uses `aria-disabled` while it waits, so a repeated
 * press is ignored without moving focus. The result is announced from a
 * status region that exists from the first render.
 */
export function TestPanel({
  payload,
  validate,
  send,
  onFormError,
  blockedReason,
  nativeDisabled,
  saving,
  onPendingChange,
}: {
  /** What a result is compared with to tell it is stale; it holds no secret value. */
  payload: TestPayload;
  /** Shows field errors and returns false when the form cannot be sent. */
  validate: () => boolean;
  /** Sends the configuration `payload` describes, with the secret values built at that moment. */
  send: () => Promise<{ result: MonitorTestResult }>;
  /** Errors that belong to the form (invalid field, denied, not found); true when handled. */
  onFormError: (error: unknown) => boolean;
  blockedReason: string | null;
  /** Off with the `disabled` attribute; a lost role keeps focus with `aria-disabled` instead. */
  nativeDisabled: boolean;
  saving: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const inFlight = useRef(false);
  const [now, setNow] = useState(() => Date.now());

  const rateLimitedUntil = state.kind === "rateLimited" ? state.until : null;
  useEffect(() => {
    if (rateLimitedUntil === null) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= rateLimitedUntil) setState({ kind: "idle" });
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [rateLimitedUntil]);

  const running = state.kind === "running";
  const waiting = state.kind === "rateLimited";
  const held = running || waiting || saving || blockedReason !== null;

  async function run() {
    if (inFlight.current || held) return;
    if (!validate()) return;
    inFlight.current = true;
    const sent = payload;
    setState({ kind: "running" });
    onPendingChange(true);
    try {
      const response = await send();
      setState({ kind: "result", result: response.result, sent });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "MONITOR_TEST_RATE_LIMITED"
      ) {
        const seconds = retryAfterOf(error) ?? 60;
        const current = Date.now();
        setNow(current);
        setState({ kind: "rateLimited", until: current + seconds * 1000 });
      } else if (onFormError(error)) {
        setState({ kind: "idle" });
      } else {
        setState({ kind: "serviceError" });
      }
    } finally {
      inFlight.current = false;
      onPendingChange(false);
    }
  }

  const stale =
    state.kind === "result" &&
    JSON.stringify(state.sent) !== JSON.stringify(payload);

  let statusText: string;
  if (state.kind === "running") statusText = "กำลังส่งคำขอทดสอบ";
  else if (state.kind === "rateLimited") statusText = "ทดสอบบ่อยเกินไป";
  else if (state.kind === "result") {
    statusText = headline(state.result, state.sent.timeoutSeconds ?? 10);
  } else if (state.kind === "idle") statusText = IDLE_TEXT;
  else statusText = "";

  const remaining =
    state.kind === "rateLimited"
      ? Math.max(1, Math.ceil((state.until - now) / 1000))
      : 0;

  return (
    <Card as="section" aria-labelledby="monitor-form-test-title" padding="md">
      <CardHeader
        id="monitor-form-test-title"
        title="ทดสอบการตั้งค่า"
        description="ส่งคำขอจริงหนึ่งครั้ง ไม่บันทึกมอนิเตอร์"
      />
      <div>
        <Button
          type="button"
          variant="secondary"
          aria-disabled={held}
          disabled={nativeDisabled}
          aria-describedby={
            waiting
              ? "monitor-form-test-wait"
              : blockedReason === null
                ? undefined
                : "monitor-form-test-blocked"
          }
          className={held ? "opacity-60" : undefined}
          onClick={() => {
            void run();
          }}
        >
          {running ? "กำลังทดสอบ…" : "ทดสอบการตั้งค่า"}
        </Button>
      </div>
      {blockedReason === null ? null : (
        <p
          id="monitor-form-test-blocked"
          className="text-sm text-foreground-secondary"
        >
          {blockedReason}
        </p>
      )}
      {/* In the DOM from the first render so a result is announced; the countdown sits outside it. */}
      <div role="status" className="text-sm font-medium">
        {statusText}
      </div>
      {waiting ? (
        <p
          id="monitor-form-test-wait"
          className="text-sm text-foreground-secondary"
        >
          ลองอีกครั้งใน {String(remaining)} วินาที
        </p>
      ) : null}
      {state.kind === "serviceError" ? (
        <Alert tone="error">ทดสอบไม่สำเร็จ ลองอีกครั้ง</Alert>
      ) : null}
      {state.kind === "result" ? (
        <ResultDetails result={state.result} sent={state.sent} stale={stale} />
      ) : null}
    </Card>
  );
}

function ResultDetails({
  result,
  sent,
  stale,
}: {
  result: MonitorTestResult;
  sent: TestPayload;
  stale: boolean;
}) {
  const rows = [
    statusRow(result, sent.expectedStatus ?? "200-299"),
    ...result.assertions.map((item, index) => {
      const configured = sent.assertions?.[index];
      return assertionRowFromResult(
        item,
        index,
        configured?.kind === "jsonPathEquals" && item.kind === "jsonPathEquals"
          ? configured.path
          : null,
      );
    }),
  ];
  return (
    <div className="flex flex-col gap-3">
      {stale ? (
        <p className="text-sm text-caution">ผลนี้ไม่ตรงกับค่าปัจจุบัน</p>
      ) : null}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {result.httpStatus === null ? null : (
          <span>รหัสสถานะ {result.httpStatus}</span>
        )}
        {result.responseTimeMs === null ? null : (
          <span>เวลาตอบสนอง {formatNumber(result.responseTimeMs)} ms</span>
        )}
        {result.ssl.level === "no_data" ? null : (
          <span>
            SSL:{" "}
            <SslLabel
              level={result.ssl.level}
              daysRemaining={result.ssl.daysRemaining}
            />
            {result.ssl.issuer === null
              ? null
              : ` (ผู้ออก ${result.ssl.issuer})`}
            {result.ssl.host === null ? null : ` โฮสต์ ${result.ssl.host}`}
          </span>
        )}
      </p>
      <p className="font-mono text-xs break-all text-foreground-secondary">
        {result.url}
      </p>
      {result.evaluatedFromPrefix ? (
        <p className="text-xs text-foreground-secondary">
          {EVALUATED_FROM_PREFIX_TEXT}
        </p>
      ) : null}
      <AssertionTable caption="ผลการทดสอบต่อเงื่อนไข" rows={rows} />
    </div>
  );
}
