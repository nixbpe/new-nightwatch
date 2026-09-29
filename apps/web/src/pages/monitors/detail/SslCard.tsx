import type { Monitor } from "@nightwatch/api-contract";

import { Card, CardHeader } from "../../../components/ui/card";
import { SslLabel } from "../SslLabel";
import { tlsReasonLabel } from "./labels";

const dateFormat = new Intl.DateTimeFormat("th-TH-u-nu-latn", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function SslCard({ ssl }: { ssl: Monitor["ssl"] }) {
  const reason = tlsReasonLabel(ssl.reason);
  const hasCertificate = ssl.issuer !== null || ssl.notAfter !== null;
  return (
    <Card as="section" aria-labelledby="detail-ssl">
      <CardHeader
        id="detail-ssl"
        title="SSL"
        action={
          <SslLabel level={ssl.state} daysRemaining={ssl.daysRemaining} />
        }
        className="border-b border-foreground/10 p-4"
      />
      <div className="flex flex-col gap-2 p-4 text-sm">
        {ssl.state === "not_https" ? (
          <p>มอนิเตอร์นี้ใช้ http ไม่มีข้อมูลใบรับรอง</p>
        ) : null}
        {ssl.state === "no_data" ? (
          <p className="text-foreground-secondary">
            ยังไม่มีข้อมูลใบรับรอง จะแสดงหลังตรวจ https สำเร็จ
          </p>
        ) : null}
        {ssl.state === "unreadable" ? (
          <p>
            อ่านใบรับรองไม่ได้
            {reason === null ? null : <> เหตุผล: {reason}</>}
          </p>
        ) : null}
        {hasCertificate ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
            {ssl.issuer === null ? null : (
              <>
                <dt className="text-foreground-secondary">ผู้ออก</dt>
                <dd>{ssl.issuer}</dd>
              </>
            )}
            {ssl.host === null ? null : (
              <>
                <dt className="text-foreground-secondary">โฮสต์</dt>
                <dd className="font-mono text-[13px]">{ssl.host}</dd>
              </>
            )}
            {ssl.notAfter === null ? null : (
              <>
                <dt className="text-foreground-secondary">หมดอายุ</dt>
                <dd>
                  <time dateTime={ssl.notAfter}>
                    {dateFormat.format(new Date(ssl.notAfter))}
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
