import type { Monitor } from "@nightwatch/api-contract";

import { Card, CardHeader } from "../../../components/ui/card";
import { formatDate } from "../format";
import { SslLabel } from "../SslLabel";
import { tlsReasonLabel } from "./labels";

export function SslCard({ ssl }: { ssl: Monitor["ssl"] }) {
  const reason = tlsReasonLabel(ssl.reason);
  const hasCertificate =
    ssl.issuer !== null || ssl.notAfter !== null || ssl.host !== null;
  // A readable certificate that fails validation keeps its level and dates but carries a reason (AC-35).
  const invalid = ssl.state !== "unreadable" && ssl.reason !== null;
  return (
    <Card
      as="section"
      data-testid="monitor-detail-ssl"
      aria-labelledby="detail-ssl"
    >
      <CardHeader
        id="detail-ssl"
        title="SSL"
        action={
          <SslLabel
            testId="monitor-detail-ssl-state"
            level={ssl.state}
            daysRemaining={ssl.daysRemaining}
          />
        }
        className="border-b border-foreground/10 p-4"
      />
      <div className="flex flex-col gap-2 p-4 text-sm">
        {ssl.state === "not_https" ? (
          <p data-testid="monitor-detail-ssl-http">
            มอนิเตอร์นี้ใช้ http ไม่มีข้อมูลใบรับรอง
          </p>
        ) : null}
        {ssl.state === "no_data" ? (
          <p
            data-testid="monitor-detail-ssl-empty"
            className="text-foreground-secondary"
          >
            ยังไม่มีข้อมูลใบรับรอง จะแสดงหลังตรวจ https สำเร็จ
          </p>
        ) : null}
        {invalid ? (
          <p
            data-testid="monitor-detail-ssl-invalid"
            data-reason={ssl.reason}
            className="font-medium text-danger"
          >
            ใบรับรองไม่ถูกต้อง{reason === null ? null : <>: {reason}</>} การตรวจ
            https ล้มเหลว
          </p>
        ) : null}
        {ssl.state === "unreadable" ? (
          <p
            data-testid="monitor-detail-ssl-unreadable"
            data-reason={ssl.reason}
          >
            อ่านใบรับรองไม่ได้
            {reason === null ? null : <> เหตุผล: {reason}</>}
          </p>
        ) : null}
        {hasCertificate ? (
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 [&>dd]:text-right">
            {ssl.issuer === null ? null : (
              <>
                <dt className="text-foreground-secondary">ผู้ออก</dt>
                <dd data-testid="monitor-detail-ssl-issuer">{ssl.issuer}</dd>
              </>
            )}
            {ssl.host === null ? null : (
              <>
                <dt className="text-foreground-secondary">โฮสต์</dt>
                <dd
                  data-testid="monitor-detail-ssl-host"
                  className="font-mono break-all"
                >
                  {ssl.host}
                </dd>
              </>
            )}
            {ssl.notAfter === null ? null : (
              <>
                <dt className="text-foreground-secondary">หมดอายุ</dt>
                <dd>
                  <time
                    data-testid="monitor-detail-ssl-expiry"
                    dateTime={ssl.notAfter}
                    className="font-mono"
                  >
                    {formatDate(ssl.notAfter)}
                  </time>
                </dd>
              </>
            )}
          </dl>
        ) : null}
      </div>
    </Card>
  );
}
