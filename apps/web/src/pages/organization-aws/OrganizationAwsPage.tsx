import type {
  OrganizationAwsConnectionResponse,
  OrganizationAwsProject,
} from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { DataTable } from "../../components/ui/data-table";
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
import { CopyButton } from "./CopyButton";
import { DENIED_MESSAGES, FAILURE_REASONS, type DeniedCode } from "./labels";

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
    enabled: allowed && deniedByServer === null,
    retry: false,
  });
  const queryDenied = isDenied(query.error) ? query.error.code : null;
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
      <div className="flex flex-wrap items-start gap-6">
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
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
          <ConnectionCard
            organizationId={organizationId}
            data={data}
            onUpdated={(next) => {
              queryClient.setQueryData(queryKey, next);
            }}
            onDenied={denyAction}
            onReload={() => void query.refetch()}
          />
          <ProjectsSection organizationId={organizationId} data={data} />
        </div>
        <SetupAside data={data} />
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
      return <span className="text-foreground-secondary">ยังไม่ทดสอบ</span>;
    }
    const outcome = test.result === "passed" ? "ผ่าน" : "ไม่ผ่าน";
    if (project.status === "stale") {
      return (
        <span className="flex flex-col text-foreground-secondary">
          <span>
            ผลเก่า · {time(test.testedAt)} · {outcome}
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
        <span className="flex flex-col">
          <span className="text-danger">{time(test.testedAt)} · ไม่ผ่าน</span>
          {test.code === null ? null : (
            <span className="text-foreground-secondary">
              {FAILURE_REASONS[test.code]}
            </span>
          )}
        </span>
      );
    }
    return (
      <span className="text-foreground-secondary">
        {time(test.testedAt)} · ผ่าน
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
            header: "Role",
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

function trustPolicy(principalArn: string, externalId: string): string {
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: principalArn },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "sts:ExternalId": externalId } },
        },
      ],
    },
    null,
    2,
  );
}

function SetupAside({ data }: { data: OrganizationAwsConnectionResponse }) {
  const policy =
    data.principalArn === null
      ? null
      : trustPolicy(data.principalArn, data.externalId);
  return (
    <Card
      as="section"
      padding="md"
      data-testid="aws-setup"
      aria-labelledby="aws-setup-title"
      className="min-w-0 flex-[1_1_320px] gap-4"
    >
      <h2 id="aws-setup-title" className="text-base font-semibold text-heading">
        ตั้งค่าในบัญชีกลาง
      </h2>
      <ol className="flex list-decimal flex-col gap-3 pl-5">
        <li>
          สร้าง role{" "}
          <span className="font-mono text-[13px]">NightWatchOrgHub</span>{" "}
          ในบัญชีกลาง
        </li>
        <li>
          ตั้ง trust policy ให้ NightWatch assume role นี้ได้เมื่อส่ง External
          ID ขององค์กรมา
        </li>
        <li>
          ให้ role นี้ assume role ปลายทางในบัญชีของโปรเจกต์ได้ ผ่านสิทธิ์{" "}
          <span className="font-mono text-[13px]">sts:AssumeRole</span>
        </li>
      </ol>
      {policy === null ? (
        // AC-02: no sample policy stands in for a live value.
        <Alert data-testid="aws-setup-incomplete" tone="warning" role="status">
          ตั้งค่า NightWatch ยังไม่ครบ: ยังไม่มี principal ของ NightWatch
          จึงยังสร้าง trust policy ไม่ได้ ติดต่อผู้ดูแลระบบ NightWatch
        </Alert>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <pre
            data-testid="aws-trust-policy"
            className="surface-inset rounded-md border border-foreground/10 p-3 font-mono text-xs leading-[18px] break-all whitespace-pre-wrap"
          >
            {policy}
          </pre>
          <div>
            <CopyButton
              value={policy}
              label="คัดลอก trust policy"
              copiedLabel="คัดลอก trust policy แล้ว"
              showLabel
              data-testid="aws-trust-policy-copy"
            />
          </div>
        </div>
      )}
      <p className="text-[13px] text-foreground-secondary">
        ผู้ที่แก้ไขหน้านี้ได้คือเจ้าของและผู้ดูแลขององค์กร
      </p>
    </Card>
  );
}
