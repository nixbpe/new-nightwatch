import {
  AUDIT_ACTION_LABELS,
  AUDIT_CATEGORY_LABELS,
  type AuditActorOption,
  type AuditEventDetail,
} from "@nightwatch/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { SectionHeader } from "../../components/ui/section-header";
import {
  auditLogQueryKeys,
  fetchAuditActors,
  fetchAuditEvent,
} from "../../lib/api/audit-log";
import { ApiError } from "../../lib/api/client";
import {
  formatAuditTimestamp,
  usePreferences,
  type Preferences,
} from "../../lib/preferences";
import { useOrganizationScope } from "../organization-members/useOrganizationScope";
import {
  DENIED_MESSAGES,
  retryAuditRead,
  useAuditAccess,
  useAuditDenial,
} from "./access";
import { AuditDenied } from "./AuditDenied";
import {
  auditValueText,
  changeFieldLabel,
  FORMER_MEMBER,
  personName,
  roleLabel,
  targetText,
} from "./labels";

const NOT_FOUND = "ไม่พบบันทึกนี้ อาจพ้นระยะเก็บบันทึกแล้ว หรือลิงก์ไม่ถูกต้อง";
const FOCUS_CLASS =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function AuditEventPage() {
  const { organizationId, eventId } = useParams();
  if (organizationId === undefined || eventId === undefined) return null;
  return (
    <AuditEventForOrganization
      key={organizationId}
      organizationId={organizationId}
      eventId={eventId}
    />
  );
}

function AuditEventForOrganization({
  organizationId,
  eventId,
}: {
  organizationId: string;
  eventId: string;
}) {
  const access = useAuditAccess(organizationId);
  const { isCurrentScope, scopeCurrent } = useOrganizationScope(organizationId);
  const { deniedCode, report } = useAuditDenial(organizationId, isCurrentScope);
  const { preferences } = usePreferences();
  const location = useLocation();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const reading =
    access.status === "allowed" && scopeCurrent && deniedCode === null;

  const event = useQuery({
    queryKey: auditLogQueryKeys.event(organizationId, eventId),
    queryFn: () => fetchAuditEvent(organizationId, eventId),
    enabled: reading,
    retry: retryAuditRead,
  });
  const actors = useQuery({
    queryKey: auditLogQueryKeys.actors(organizationId),
    queryFn: () => fetchAuditActors(organizationId),
    enabled: reading,
    retry: retryAuditRead,
  });
  useEffect(() => {
    report(event.error);
  }, [event.error, report]);
  useEffect(() => {
    report(actors.error);
  }, [actors.error, report]);

  // AC-18: opening a detail page puts focus on its h1.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const state = location.state as { search?: string; eventId?: string } | null;
  const backTo = `/organizations/${organizationId}/audit-log${state?.search ?? ""}`;
  const back = (
    <Button asChild variant="secondary">
      <Link to={backTo} state={{ eventId: state?.eventId }}>
        กลับไปบันทึกกิจกรรม
      </Link>
    </Button>
  );
  const header = (title: string, status?: ReactNode) => (
    <PageHeader
      status={status}
      eyebrow="// audit-log"
      title={title}
      titleRef={titleRef}
      titleTabIndex={-1}
      titleClassName={FOCUS_CLASS}
      actions={back}
    />
  );

  if (access.status === "loading" || !scopeCurrent) {
    return (
      <Page>
        {header("รายละเอียดบันทึกกิจกรรม")}
        <PageState kind="loading" label="กำลังโหลดรายละเอียด" />
      </Page>
    );
  }
  if (access.status === "error") {
    return (
      <Page>
        {header("รายละเอียดบันทึกกิจกรรม")}
        <PageState
          kind="error"
          message="ไม่สามารถยืนยันสิทธิ์ดูบันทึกกิจกรรมได้"
          onRetry={() => void access.retry()}
        />
      </Page>
    );
  }
  if (access.status === "denied" || deniedCode !== null) {
    const code =
      deniedCode ?? (access.status === "denied" ? access.code : null);
    return (
      <Page>
        {header("รายละเอียดบันทึกกิจกรรม")}
        <AuditDenied message={DENIED_MESSAGES[code ?? "PERMISSION_DENIED"]} />
      </Page>
    );
  }

  const detail =
    event.data?.organizationId === organizationId
      ? event.data.event
      : undefined;
  if (detail === undefined) {
    if (event.error instanceof ApiError && event.error.status === 404) {
      return (
        <Page>
          {header("รายละเอียดบันทึกกิจกรรม")}
          <Card as="section" padding="md">
            <p className="text-sm">{NOT_FOUND}</p>
          </Card>
        </Page>
      );
    }
    return (
      <Page>
        {header("รายละเอียดบันทึกกิจกรรม")}
        {event.isError && !event.isFetching ? (
          <PageState
            kind="error"
            message="โหลดรายละเอียดไม่สำเร็จ ลองใหม่อีกครั้ง"
            onRetry={() => void event.refetch()}
          />
        ) : (
          <PageState kind="loading" label="กำลังโหลดรายละเอียด" />
        )}
      </Page>
    );
  }

  const time = formatAuditTimestamp(new Date(detail.occurredAt), preferences);
  return (
    <Page>
      {header(
        AUDIT_ACTION_LABELS[detail.action],
        <>
          <span>
            <span className="font-mono">{time}</span> {preferences.timeZone}
          </span>
          <span>
            รหัสเหตุการณ์ <span className="font-mono">{detail.id}</span>
          </span>
          <CopyId value={detail.id} />
        </>,
      )}
      <Section code="01" title="ผู้ดำเนินการ">
        <Fields>
          <Field label="ชื่อ">{personName(detail.actor)}</Field>
          <Field label="บทบาท ณ เวลานั้น">
            {roleLabel(detail.actor.roleAtTime)}
          </Field>
        </Fields>
      </Section>
      <Section code="02" title="การกระทำและเป้าหมาย">
        <Fields>
          <Field label="การกระทำ">{AUDIT_ACTION_LABELS[detail.action]}</Field>
          <Field label="รหัสการกระทำ">
            <span className="font-mono">{detail.action}</span>
          </Field>
          <Field label="หมวด">{AUDIT_CATEGORY_LABELS[detail.category]}</Field>
          <Field label="เป้าหมาย">
            <TargetValue
              organizationId={organizationId}
              detail={detail}
              role={access.role}
            />
          </Field>
        </Fields>
      </Section>
      {detail.exportScope === undefined ? (
        <ChangesSection detail={detail} />
      ) : (
        <ExportScopeSection
          scope={detail.exportScope}
          preferences={preferences}
          actors={actors.data?.actors}
        />
      )}
    </Page>
  );
}

function Section({
  code,
  title,
  children,
}: {
  code: string;
  title: string;
  children: ReactNode;
}) {
  const id = `audit-detail-${code}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <SectionHeader id={id} code={code} title={title} />
      {children}
    </section>
  );
}

function Fields({ children }: { children: ReactNode }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
      {children}
    </dl>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-foreground-secondary">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
          });
        }}
      >
        คัดลอก
      </Button>
      <span role="status" className="sr-only">
        {copied ? "คัดลอกรหัสเหตุการณ์แล้ว" : ""}
      </span>
    </>
  );
}

// a-1: only a monitor links for every reader; a member links for owner and admin; the rest is text.
function TargetValue({
  organizationId,
  detail,
  role,
}: {
  organizationId: string;
  detail: AuditEventDetail;
  role: string;
}) {
  const { target } = detail;
  const linkClass =
    "rounded-[4px] text-primary underline-offset-4 hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  if (
    target.type === "monitor" &&
    !target.deleted &&
    target.displayName !== null
  ) {
    return (
      <Link
        className={linkClass}
        to={`/organizations/${organizationId}/monitors/${target.monitorId}`}
        aria-label={`เปิดมอนิเตอร์ ${target.displayName}`}
      >
        {target.displayName}
      </Link>
    );
  }
  if (
    target.type === "member" &&
    target.membership === "current" &&
    target.displayName !== null &&
    (role === "owner" || role === "admin")
  ) {
    return (
      <Link
        className={linkClass}
        to={`/organizations/${organizationId}/members`}
        aria-label={`เปิดสมาชิก ${target.displayName}`}
      >
        {target.displayName}
      </Link>
    );
  }
  if (target.type === "invitation") {
    return (
      <>
        {targetText(target)}{" "}
        <span className="font-mono text-foreground-secondary">
          {target.publicId}
        </span>
      </>
    );
  }
  return <>{targetText(target)}</>;
}

function ChangesSection({ detail }: { detail: AuditEventDetail }) {
  return (
    <Section code="03" title="การเปลี่ยนแปลง">
      {detail.changes.length === 0 ? (
        <p className="text-sm text-foreground-secondary">
          เหตุการณ์นี้ไม่มีข้อมูลการเปลี่ยนแปลง
        </p>
      ) : (
        <div className="overflow-auto rounded-md border border-foreground/10 bg-surface">
          <table className="w-full min-w-[480px] text-left text-sm">
            <caption className="sr-only">การเปลี่ยนแปลงก่อนและหลัง</caption>
            <thead className="text-xs font-medium text-foreground-secondary">
              <tr>
                {["ฟิลด์", "ก่อน", "หลัง"].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="h-11 border-b border-foreground/10 px-4 font-medium"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.changes.map((change, index) => (
                <tr
                  key={`${change.field}:${change.key ?? ""}:${index.toString()}`}
                  className="border-b border-foreground/10 last:border-0"
                >
                  <th scope="row" className="px-4 py-2.5 align-top font-medium">
                    {changeFieldLabel(change)}
                  </th>
                  <td className="px-4 py-2.5 align-top font-mono text-[13px] break-all">
                    {auditValueText(change.field, change.before)}
                  </td>
                  <td className="px-4 py-2.5 align-top font-mono text-[13px] break-all">
                    {auditValueText(change.field, change.after)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// a-2: the scope of an export request; the search text itself is never stored, only whether one applied.
function ExportScopeSection({
  scope,
  preferences,
  actors,
}: {
  scope: NonNullable<AuditEventDetail["exportScope"]>;
  preferences: Preferences;
  actors: readonly AuditActorOption[] | undefined;
}) {
  const stamp = (value: string | null, fallback: string) =>
    value === null
      ? fallback
      : formatAuditTimestamp(new Date(value), preferences);
  const found = actors?.find((item) => item.userId === scope.actorUserId);
  let actor = "ทั้งหมด";
  if (scope.actorUserId !== null) {
    actor =
      actors === undefined
        ? "—"
        : found === undefined
          ? FORMER_MEMBER
          : personName(found);
  }
  return (
    <Section code="03" title="ขอบเขตการส่งออก">
      <Fields>
        <Field label="รูปแบบ">{scope.format.toUpperCase()}</Field>
        <Field label="ช่วงเวลา">
          <span className="font-mono">
            {stamp(scope.from, "ไม่ระบุ")} – {stamp(scope.to, "ไม่ระบุ")}
          </span>{" "}
          {preferences.timeZone}
        </Field>
        <Field label="หมวด">
          {scope.categories.length === 0
            ? "ทั้งหมด"
            : scope.categories
                .map((category) => AUDIT_CATEGORY_LABELS[category])
                .join(", ")}
        </Field>
        <Field label="ผู้ดำเนินการ">{actor}</Field>
        <Field label="มีการค้นหาข้อความ">
          {scope.searchApplied ? "ใช่" : "ไม่"}
        </Field>
      </Fields>
    </Section>
  );
}
