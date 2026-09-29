import type { Monitor } from "@nightwatch/api-contract";

import { Card, CardHeader } from "../../../components/ui/card";
import { authText, intervalText } from "./labels";

// A secret row in the record means its value is stored; the value itself never reaches the client.
export function ConfigCard({ monitor }: { monitor: Monitor }) {
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
          {monitor.auth.type === "none" ? null : " (ตั้งค่าแล้ว)"}
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
                        ตั้งค่าแล้ว (ค่าลับ)
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
      </dl>
    </Card>
  );
}
