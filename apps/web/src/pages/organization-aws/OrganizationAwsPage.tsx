import type {
  OrganizationAwsConnectionResponse,
  OrganizationAwsProject,
} from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { CopyButton } from "../../components/ui/copy-button";
import { DataTable } from "../../components/ui/data-table";
import { StatusPill } from "../../components/ui/status-pill";
import {
  fetchOrganizationAwsConnection,
  organizationAwsConnectionQueryKey,
} from "../../lib/api/aws-connection";
import { ApiError } from "../../lib/api/client";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { formatDateTime, usePreferences } from "../../lib/preferences";
import { ROLE_LABELS } from "../../lib/roles";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { ConnectionCard } from "./ConnectionCard";
import {
  DENIED_MESSAGES,
  FAILURE_REASONS,
  SETUP_STEPS_ID,
  type DeniedCode,
} from "./labels";
import { permissionPolicy, trustPolicy } from "./policies";

export function OrganizationAwsPage() {
  const { organizationId } = useParams();
  if (organizationId === undefined) return null;
  // Keyed so a draft, a test result or a pending answer never carries over to another Organization (AC-11).
  return (
    <OrganizationAws key={organizationId} organizationId={organizationId} />
  );
}

function isDenied(error: unknown): error is ApiError & { code: DeniedCode } {
  return (
    error instanceof ApiError &&
    (error.code === "PERMISSION_DENIED" || error.code === "MEMBERSHIP_DENIED")
  );
}

function OrganizationAws({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const { me, mePending, meError, retryMe } = useTenant();
  const organization = me?.organizations.find(
    (item) => item.id === organizationId,
  );
  const allowed =
    organization?.role === "owner" || organization?.role === "admin";
  const [deniedByServer, setDeniedByServer] = useState<DeniedCode | null>(null);
  const queryKey = organizationAwsConnectionQueryKey(organizationId);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchOrganizationAwsConnection(organizationId),
    // A cached denial stops every automatic refetch (mount, focus,
    // invalidation): the shell remounts this page while the context reloads,
    // and a context that still says Owner must not repeat the request.
    enabled: (cached) =>
      allowed && deniedByServer === null && !isDenied(cached.state.error),
    retry: false,
  });
  const queryDenied = isDenied(query.error) ? query.error.code : null;
  // Only a denial that arrived while this page was mounted refreshes the
  // context (hiding the menu entry, AC-08). One already in the cache was
  // handled by whoever stored it (the route loader or an earlier mount), so a
  // context that still says Owner cannot loop.
  const [errorsAtMount] = useState(
    () => queryClient.getQueryState(queryKey)?.errorUpdateCount ?? 0,
  );
  const freshDenial =
    queryDenied !== null && query.errorUpdateCount > errorsAtMount;
  useEffect(() => {
    if (freshDenial)
      void queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
  }, [freshDenial, queryClient]);
  // A Test, Save or Disconnect denial latches, drops the cached settings and
  // refreshes the context, which then hides the menu entry (AC-08, AC-11).
  const denyAction = (code: DeniedCode) => {
    setDeniedByServer((current) => current ?? code);
    queryClient.removeQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
  };

  const header = (
    <PageHeader
      eyebrow="// AWS"
      scope={
        organization === undefined
          ? { label: "องค์กร" }
          : {
              mark: organization.name,
              label: organization.name,
              tag: `องค์กร · ${ROLE_LABELS[organization.role] ?? organization.role}`,
            }
      }
      title="การเชื่อมต่อ AWS"
      status={
        query.data === undefined || !allowed ? undefined : (
          <HeaderStatus data={query.data} />
        )
      }
      description="บัญชี AWS กลางขององค์กรที่ NightWatch ใช้ assume role เข้าบัญชีของแต่ละโปรเจกต์ โปรเจกต์ที่เลือกวิธีนี้จึงไม่ต้องเก็บ access key เอง"
    />
  );

  let body;
  if (me === undefined) {
    body =
      mePending || meError === null ? (
        <PageState
          kind="loading"
          data-testid="aws-loading"
          label="กำลังโหลดการเชื่อมต่อ AWS…"
        />
      ) : (
        <PageState
          kind="error"
          data-testid="aws-load-error"
          message="โหลดข้อมูลองค์กรไม่สำเร็จ"
          retryTestId="aws-load-retry"
          onRetry={() => void retryMe()}
        />
      );
  } else if (deniedByServer !== null || queryDenied !== null || !allowed) {
    const code =
      deniedByServer ??
      queryDenied ??
      (organization === undefined ? "MEMBERSHIP_DENIED" : "PERMISSION_DENIED");
    body = (
      <PageState
        kind="denied"
        data-testid="aws-denied"
        alertTestId="aws-denied-message"
        message={DENIED_MESSAGES[code]}
      />
    );
  } else if (query.isPending) {
    body = (
      <PageState
        kind="loading"
        data-testid="aws-loading"
        label="กำลังโหลดการเชื่อมต่อ AWS…"
      />
    );
  } else if (query.data === undefined) {
    // A failed first load shows no table at all, so it never reads as "no Projects" (AC-07).
    body = (
      <PageState
        kind="error"
        data-testid="aws-load-error"
        message="โหลดการเชื่อมต่อ AWS ไม่สำเร็จ ยังไม่ทราบสถานะการเชื่อมต่อและโปรเจกต์"
        retryTestId="aws-load-retry"
        onRetry={() => void query.refetch()}
      />
    );
  } else {
    const data = query.data;
    body = (
      <div className="flex flex-col gap-6">
        {query.isError ? (
          // A failed refetch keeps the form and its draft; the shown data is marked as possibly old.
          <div
            data-testid="aws-refresh-error"
            className="flex w-full flex-wrap items-center gap-3"
          >
            <Alert tone="error">
              โหลดข้อมูลล่าสุดไม่สำเร็จ ข้อมูลด้านล่างอาจไม่ใช่สถานะปัจจุบัน
            </Alert>
            <Button
              data-testid="aws-refresh-retry"
              type="button"
              variant="secondary"
              onClick={() => void query.refetch()}
            >
              ลองใหม่
            </Button>
          </div>
        ) : null}
        {data.connection === null ? <SetupSteps data={data} /> : null}
        <ConnectionCard
          organizationId={organizationId}
          data={data}
          onUpdated={(next) => {
            // A GET that started before the change would answer with the
            // old snapshot; cancel it so it cannot overwrite the result.
            void queryClient.cancelQueries({ queryKey }).then(() => {
              queryClient.setQueryData(queryKey, next);
            });
          }}
          onDenied={denyAction}
          onReload={() => void query.refetch()}
        />
        <ProjectsSection organizationId={organizationId} data={data} />
        {data.connection === null ? null : <SetupSteps data={data} />}
      </div>
    );
  }

  return (
    <Page>
      {header}
      {body}
    </Page>
  );
}

function HeaderStatus({ data }: { data: OrganizationAwsConnectionResponse }) {
  if (data.connection === null) {
    return (
      <span data-testid="aws-header-status">ยังไม่เชื่อมต่อบัญชีกลาง</span>
    );
  }
  return (
    <span data-testid="aws-header-status">
      บัญชีกลาง <span className="font-mono">{data.connection.accountId}</span> ·
      ใช้อยู่ใน{" "}
      <span className="font-mono">{data.projects.length.toString()}</span>{" "}
      โปรเจกต์
    </span>
  );
}

function ProjectsSection({
  organizationId,
  data,
}: {
  organizationId: string;
  data: OrganizationAwsConnectionResponse;
}) {
  const { preferences } = usePreferences();
  const time = (value: string) => (
    <span className="font-mono text-[13px]">
      {formatDateTime(new Date(value), preferences)}
    </span>
  );
  const lastTest = (project: OrganizationAwsProject) => {
    const test = project.lastTest;
    if (project.status === "untested" || test === null) {
      return <StatusPill dot>ยังไม่ทดสอบ</StatusPill>;
    }
    const outcome = test.result === "passed" ? "ผ่าน" : "ไม่ผ่าน";
    const stamp = (
      <span className="text-foreground-secondary">{time(test.testedAt)}</span>
    );
    if (project.status === "stale") {
      return (
        <span className="flex flex-col items-start gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone="caution" dot>
              ผลเก่า
            </StatusPill>
            {stamp}
            <span className="text-foreground-secondary">{outcome}</span>
          </span>
          <span className="text-caution">
            {data.connection === null
              ? "ต้องตั้งค่าบัญชีกลางแล้วทดสอบใหม่"
              : "ต้องทดสอบใหม่กับบัญชีกลางปัจจุบัน"}
          </span>
        </span>
      );
    }
    if (test.result === "failed") {
      return (
        <span className="flex flex-col items-start gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone="danger" dot>
              ไม่ผ่าน
            </StatusPill>
            {stamp}
          </span>
          {test.code === null ? null : (
            <span className="text-foreground-secondary">
              {FAILURE_REASONS[test.code]}
            </span>
          )}
        </span>
      );
    }
    return (
      <span className="flex flex-wrap items-center gap-2">
        <StatusPill tone="primary" dot>
          ผ่าน
        </StatusPill>
        {stamp}
      </span>
    );
  };
  return (
    <Card
      as="section"
      data-testid="aws-projects"
      aria-labelledby="aws-projects-title"
    >
      <div className="px-6 pt-6 pb-4">
        <h2
          id="aws-projects-title"
          className="text-base font-semibold text-heading"
        >
          โปรเจกต์ที่ใช้การเชื่อมต่อนี้
        </h2>
      </div>
      <DataTable
        ariaLabel="โปรเจกต์ที่ใช้บัญชี AWS กลาง"
        className="rounded-none border-x-0 border-b-0"
        tableTestId="aws-projects-table"
        rowTestId={(project) => `aws-project-${project.projectId}`}
        rows={data.projects}
        rowKey={(project) => project.projectId}
        empty={
          <span data-testid="aws-projects-empty">
            ยังไม่มีโปรเจกต์ที่เชื่อมต่อผ่านบัญชีกลาง
            เลือกวิธีนี้ในโปรเจกต์ได้จาก{" "}
            <Link
              data-testid="aws-projects-empty-link"
              to={`/organizations/${organizationId}/projects`}
              className="text-primary underline-offset-4 hover:underline"
            >
              รายการโปรเจกต์
            </Link>
          </span>
        }
        columns={[
          {
            key: "project",
            header: "โปรเจกต์",
            cell: (project) => (
              <Link
                to={`/organizations/${organizationId}/projects/${project.projectId}/overview`}
                className="font-medium text-foreground hover:underline"
              >
                {project.projectName}
              </Link>
            ),
          },
          {
            key: "account",
            header: "บัญชีปลายทาง",
            mono: true,
            cell: (project) => project.accountId,
          },
          {
            key: "role",
            header: "Role ปลายทาง",
            mono: true,
            cell: (project) => (
              <span
                className="break-all text-foreground-secondary"
                title={project.roleArn}
              >
                {project.roleArn.replace(/^arn:aws:iam::\d{12}:/, "")}
              </span>
            ),
          },
          {
            key: "test",
            header: "ทดสอบล่าสุด",
            cell: (project) => (
              <span data-testid="aws-project-status">{lastTest(project)}</span>
            ),
          },
        ]}
      />
      <p className="border-t border-foreground/10 px-6 py-3 text-[13px] text-foreground-secondary">
        โปรเจกต์ที่ใช้ access key ของตัวเองไม่อยู่ในรายการนี้
        และไม่ได้รับผลกระทบจากการเปลี่ยนบัญชีกลาง
      </p>
    </Card>
  );
}

const AWS_DOCS = {
  externalId:
    "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html",
  createRole:
    "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user.html",
  permissions:
    "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_permissions-to-switch.html",
} as const;

const linkClass =
  "text-primary underline-offset-4 hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function DocsLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`w-fit text-[13px] ${linkClass}`}
    >
      {children}
    </a>
  );
}

function PolicyBlock({
  policy,
  testId,
  label,
}: {
  policy: string;
  testId: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <pre
        data-testid={testId}
        className="surface-inset rounded-md border border-foreground/10 p-3 font-mono text-xs leading-[18px] break-all whitespace-pre-wrap"
      >
        {policy}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton
          value={policy}
          label={label}
          copiedLabel={`${label} แล้ว`}
          showLabel
          data-testid={`${testId}-copy`}
        />
      </div>
    </div>
  );
}

// Open until the account is connected, then folded away: the steps matter once,
// but a failed re-test links back here (the card opens it).
function SetupSteps({ data }: { data: OrganizationAwsConnectionResponse }) {
  const connected = data.connection !== null;
  const trust =
    data.principalArn === null
      ? null
      : trustPolicy(data.principalArn, data.externalId);
  const permission = permissionPolicy(
    data.projects.map((project) => project.roleArn),
  );
  return (
    <Card
      as="section"
      padding="md"
      data-testid="aws-setup"
      aria-labelledby="aws-setup-title"
      className="min-w-0 gap-0"
    >
      <details
        id={SETUP_STEPS_ID}
        data-testid="aws-setup-steps"
        open={!connected}
      >
        <summary className="cursor-pointer rounded-[4px] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <h2
            id="aws-setup-title"
            className="inline text-base font-semibold text-heading"
          >
            ขั้นตอนตั้งค่าในบัญชีกลาง
          </h2>
        </summary>
        <ol className="mt-4 flex list-decimal flex-col gap-5 pl-5">
          <li className="flex flex-col gap-2">
            <span>คัดลอก External ID ขององค์กร</span>
            {connected ? (
              <span className="text-[13px] text-foreground-secondary">
                External ID อยู่ในการ์ดการเชื่อมต่อด้านบน
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
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
              </div>
            )}
            <DocsLink href={AWS_DOCS.externalId}>
              เอกสาร AWS เรื่อง External ID
            </DocsLink>
          </li>
          <li className="flex flex-col gap-2">
            <span>
              สร้าง role{" "}
              <span className="font-mono text-[13px]">NightWatchOrgHub</span>{" "}
              ในบัญชีกลาง แล้วตั้ง trust policy นี้ให้ NightWatch assume role
              ได้เมื่อส่ง External ID ขององค์กรมา
            </span>
            {trust === null ? (
              // AC-02: no sample policy stands in for a live value.
              <Alert
                data-testid="aws-setup-incomplete"
                tone="warning"
                role="status"
              >
                ตั้งค่า NightWatch ยังไม่ครบ: ยังไม่มี principal ของ NightWatch
                จึงยังสร้าง trust policy ไม่ได้ ติดต่อผู้ดูแลระบบ NightWatch
              </Alert>
            ) : (
              <PolicyBlock
                policy={trust}
                testId="aws-trust-policy"
                label="คัดลอก trust policy"
              />
            )}
            <DocsLink href={AWS_DOCS.createRole}>
              เอกสาร AWS เรื่องการสร้าง role
            </DocsLink>
          </li>
          <li className="flex flex-col gap-2">
            <span>
              ให้ role นี้ assume role ปลายทางในบัญชีของโปรเจกต์ได้ ด้วย
              permission policy นี้ (สิทธิ์{" "}
              <span className="font-mono text-[13px]">sts:AssumeRole</span>)
            </span>
            <PolicyBlock
              policy={permission}
              testId="aws-permission-policy"
              label="คัดลอก permission policy"
            />
            <span className="text-[13px] text-foreground-secondary">
              Resource คือ Role ARN ของโปรเจกต์ที่ใช้บัญชีกลางอยู่ตอนนี้
              ถ้ายังไม่มีโปรเจกต์ ให้แทนที่ค่าในเครื่องหมาย &lt; &gt; ด้วย Role
              ARN ของ role ในบัญชีโปรเจกต์ และเพิ่ม Resource เมื่อมีโปรเจกต์ใหม่
            </span>
            <DocsLink href={AWS_DOCS.permissions}>
              เอกสาร AWS เรื่องสิทธิ์ assume role
            </DocsLink>
          </li>
          <li>
            ใส่ Role ARN ของ role นี้ในการ์ดบัญชี AWS กลางขององค์กร ทดสอบ
            แล้วบันทึก
          </li>
        </ol>
        <p className="mt-4 text-[13px] text-foreground-secondary">
          ผู้ที่แก้ไขหน้านี้ได้คือเจ้าของและผู้ดูแลขององค์กร
        </p>
      </details>
    </Card>
  );
}
