import type { Monitor } from "@nightwatch/api-contract";

import { Card, CardHeader } from "../../../components/ui/card";
import { ASSERTION_KIND_LABELS, authText, intervalText } from "./labels";

const AUTH_SLOTS = {
  none: [],
  bearer: ["auth.token"],
  basic: ["auth.username", "auth.password"],
  apiKey: ["auth.apiKey"],
} as const;

const SECRET_SET = "ตั้งค่าแล้ว";
const SECRET_MISSING = "ยังไม่ได้ตั้งค่า";

type Assertion = Monitor["assertions"][number];

function assertionText(assertion: Assertion): string {
  const label = ASSERTION_KIND_LABELS[assertion.kind];
  switch (assertion.kind) {
    case "jsonPathEquals":
      return `${label} ${assertion.path} = ${assertion.expected}`;
    case "bodyContains":
      return `${label} ${assertion.text}`;
    case "responseTimeBelow":
      return `${label} ${String(assertion.ms)} ms`;
  }
}

// Secret values never reach the client: "set" comes from the stored slots, not from the config rows.
// Query parameters and body are not secret (OD-23), so every reader sees them.
export function ConfigCard({ monitor }: { monitor: Monitor }) {
  const stored = new Set(monitor.secretSlots.map((item) => item.slot));
  const authSet = AUTH_SLOTS[monitor.auth.type].every((slot) =>
    stored.has(slot),
  );
  const showsPlainValues =
    monitor.queryParams.length > 0 || monitor.body !== null;
  return (
    <Card as="section" aria-labelledby="detail-config">
      <CardHeader
        id="detail-config"
        title="การตั้งค่า"
        className="border-b border-foreground/10 p-4"
      />
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 p-4 text-sm">
        <dt className="text-foreground-secondary">Method</dt>
        <dd className="font-mono text-[13px]">{monitor.method}</dd>
        <dt className="text-foreground-secondary">รอบตรวจ</dt>
        <dd>{intervalText(monitor.intervalSeconds)}</dd>
        <dt className="text-foreground-secondary">หมดเวลา</dt>
        <dd>{monitor.timeoutSeconds} วินาที</dd>
        <dt className="text-foreground-secondary">รหัสสถานะที่ถือว่าปกติ</dt>
        <dd className="font-mono text-[13px]">{monitor.expectedStatus}</dd>
        <dt className="text-foreground-secondary">การยืนยันตัวตน</dt>
        <dd>
          {authText(monitor.auth)}
          {monitor.auth.type === "none"
            ? null
            : ` (${authSet ? SECRET_SET : SECRET_MISSING})`}
        </dd>
        {monitor.headers.length === 0 ? null : (
          <>
            <dt className="text-foreground-secondary">Headers</dt>
            <dd>
              <ul>
                {monitor.headers.map((header) => (
                  <li key={header.id ?? header.name}>
                    <span className="font-mono text-[13px]">{header.name}</span>{" "}
                    {header.secret ? (
                      <span className="text-foreground-secondary">
                        {header.id !== undefined &&
                        stored.has(`header.${header.id.toLowerCase()}`)
                          ? `${SECRET_SET} (ค่าลับ)`
                          : `${SECRET_MISSING} (ค่าลับ)`}
                      </span>
                    ) : (
                      <span className="font-mono text-[13px] break-all text-foreground-secondary">
                        {header.value}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {monitor.queryParams.length === 0 ? null : (
          <>
            <dt className="text-foreground-secondary">Query parameters</dt>
            <dd>
              <ul>
                {monitor.queryParams.map((param, index) => (
                  <li key={`${String(index)}:${param.name}`}>
                    <span className="font-mono text-[13px] break-all">
                      {param.name}={param.value}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {monitor.body === null ? null : (
          <>
            <dt className="text-foreground-secondary">
              Body ({monitor.body.type})
            </dt>
            <dd>
              <pre
                tabIndex={0}
                className="max-h-40 overflow-auto rounded-md border border-foreground/10 p-2 font-mono text-[13px] whitespace-pre-wrap break-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {monitor.body.content}
              </pre>
            </dd>
          </>
        )}
        {monitor.assertions.length === 0 ? null : (
          <>
            <dt className="text-foreground-secondary">เงื่อนไขตรวจสอบ</dt>
            <dd>
              <ul>
                {monitor.assertions.map((assertion, index) => (
                  <li key={`${String(index)}:${assertion.kind}`}>
                    <span className="break-all">
                      {assertionText(assertion)}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
      {showsPlainValues ? (
        <p className="border-t border-foreground/10 px-4 py-3 text-xs text-foreground-secondary">
          ผู้ที่ดูมอนิเตอร์เห็นค่านี้ได้ ห้ามใส่ความลับ ใช้ header ลับแทน
        </p>
      ) : null}
    </Card>
  );
}
