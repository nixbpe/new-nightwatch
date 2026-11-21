import type { AwsProject } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import {
  awsKeys,
  checkProjectAws,
  disconnectProjectAws,
  fetchProjectAws,
} from "../../lib/api/aws";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import {
  AwsConnectionForm,
  awsRequestError,
  CopyValue,
} from "./AwsConnectionForm";

type Scope = { organizationId: string; projectId: string };
function useAwsProject({ organizationId, projectId }: Scope, enabled: boolean) {
  return useQuery({
    queryKey: awsKeys.project(organizationId, projectId),
    queryFn: ({ signal }) => fetchProjectAws(organizationId, projectId, signal),
    enabled,
    retry: false,
    refetchOnMount: "always",
  });
}

export function AwsProjectStatus({ connection }: { connection: AwsProject }) {
  if (connection.state === "disconnected")
    return <p data-testid="aws-disconnected">ยังไม่ได้เชื่อมต่อ</p>;
  return (
    <div data-testid="aws-connection-status" className="space-y-1">
      <p>
        {connection.method === "assume_role" ? "Assume role" : "Access key"} ·{" "}
        {connection.accountId}
      </p>
      <p>
        {connection.state === "needs_retest"
          ? "ต้องทดสอบใหม่ · ผลเดิม: ผ่าน"
          : "ผลทดสอบล่าสุด: ผ่าน"}{" "}
        {connection.lastTestAt && (
          <time dateTime={connection.lastTestAt}>
            {new Date(connection.lastTestAt).toLocaleString("th-TH")}
          </time>
        )}
      </p>
    </div>
  );
}

export function ProjectAwsCard({ organizationId, projectId }: Scope) {
  const query = useAwsProject({ organizationId, projectId }, true);
  return (
    <section
      aria-label="การเชื่อมต่อ AWS"
      data-testid="project-aws-card"
      className="space-y-2 rounded-md border border-foreground/10 bg-surface p-4"
    >
      <h2 className="font-semibold">การเชื่อมต่อ AWS</h2>
      {query.isPending ? (
        <p role="status">กำลังโหลด…</p>
      ) : query.isError ? (
        <p role="alert">{awsRequestError(query.error)}</p>
      ) : (
        <>
          {query.isFetching ? (
            <p role="status">กำลังตรวจสอบสถานะ…</p>
          ) : (
            <AwsProjectStatus connection={query.data} />
          )}
          <Link
            to={`/organizations/${organizationId}/projects/${projectId}/aws`}
          >
            {query.data.settings
              ? "ตั้งค่าการเชื่อมต่อ AWS"
              : "ดูการเชื่อมต่อ AWS"}
          </Link>
        </>
      )}
    </section>
  );
}

export function ProjectAwsPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return null;
  const org = organizationId.toLowerCase();
  const project = projectId.toLowerCase();
  return (
    <ProjectAws
      key={`${org}:${project}`}
      organizationId={org}
      projectId={project}
    />
  );
}

function ProjectAws({ organizationId, projectId }: Scope) {
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const queryClient = useQueryClient();
  const disconnectFocus = useRef<HTMLDivElement>(null);
  const { me } = useTenant();
  const role = me?.organizations.find((org) => org.id === organizationId)?.role;
  const [selectedMethod, setSelectedMethod] = useState<
    "assume_role" | "access_key" | null
  >(null);
  const query = useAwsProject({ organizationId, projectId }, !switched);
  if (switched) return null;
  const connection = query.data;
  const settings = connection?.settings;
  const method =
    selectedMethod ??
    connection?.method ??
    (settings?.hubConnected ? "assume_role" : "access_key");
  return (
    <Page>
      <div
        ref={disconnectFocus}
        tabIndex={-1}
        data-testid="project-aws-heading-focus"
      >
        <PageHeader title="การเชื่อมต่อ AWS ของโปรเจกต์" />
      </div>
      {query.isPending ? (
        <p role="status">กำลังโหลดการเชื่อมต่อ AWS…</p>
      ) : query.isError ? (
        <Alert tone="error" role="alert">
          {awsRequestError(query.error)}{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            ลองใหม่
          </Button>
        </Alert>
      ) : (
        connection && (
          <div className="space-y-6">
            {query.isFetching ? (
              <p role="status">กำลังตรวจสอบสถานะ…</p>
            ) : (
              <AwsProjectStatus connection={connection} />
            )}
            {settings && (
              <>
                <p>
                  {settings.hubConnected
                    ? "เชื่อมบัญชีกลางขององค์กรแล้ว"
                    : "ให้ Owner หรือ Admin ตั้งค่าบัญชีกลางขององค์กรก่อน"}{" "}
                  {(role === "owner" || role === "admin") && (
                    <Link to={`/organizations/${organizationId}/aws`}>
                      การเชื่อมต่อขององค์กร
                    </Link>
                  )}
                </p>
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label="วิธีเชื่อมต่อ AWS"
                >
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="aws-method-role"
                    aria-pressed={method === "assume_role"}
                    disabled={!settings.hubConnected}
                    onClick={() => {
                      setSelectedMethod("assume_role");
                    }}
                  >
                    Assume role
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="aws-method-key"
                    aria-pressed={method === "access_key"}
                    onClick={() => {
                      setSelectedMethod("access_key");
                    }}
                  >
                    Access key
                  </Button>
                </div>
                {connection.secretSet && (
                  <p data-testid="aws-key-set">ตั้งค่าแล้ว</p>
                )}
                {method === "access_key" && (
                  <p>
                    หมุนคีย์ด้วยตนเองโดยใส่คู่ใหม่ทั้งชุด แนะนำ Assume role
                    เมื่อใช้บัญชีกลางได้
                  </p>
                )}
                {method === "assume_role" && (
                  <CopyValue label="External ID" value={settings.externalId} />
                )}
                {method === "assume_role" && settings.trustPolicy && (
                  <CopyValue
                    label="นโยบายความเชื่อถือ"
                    value={settings.trustPolicy}
                  />
                )}
                <AwsConnectionForm
                  key={method}
                  disconnectFocus={disconnectFocus}
                  initialRoleArn={settings.roleArn}
                  canTest={method === "access_key" || settings.hubConnected}
                  access={
                    method === "access_key"
                      ? {
                          region: settings.region ?? "us-east-1",
                          check: (draft, save, signal) =>
                            checkProjectAws(
                              organizationId,
                              projectId,
                              draft,
                              save,
                              signal,
                            ),
                        }
                      : undefined
                  }
                  saved={connection.method !== null}
                  affected="โปรเจกต์นี้จะไม่ได้เชื่อมต่อกับ AWS"
                  check={(arn, save, signal) =>
                    checkProjectAws(
                      organizationId,
                      projectId,
                      { method: "assume_role", roleArn: arn },
                      save,
                      signal,
                    )
                  }
                  disconnect={(signal) =>
                    disconnectProjectAws(organizationId, projectId, signal)
                  }
                  changed={() =>
                    queryClient.invalidateQueries({
                      queryKey: awsKeys.all(organizationId),
                    })
                  }
                />
              </>
            )}
          </div>
        )
      )}
    </Page>
  );
}
