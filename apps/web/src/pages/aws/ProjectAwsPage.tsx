import type { AwsProject } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
          <AwsProjectStatus connection={query.data} />
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
  return (
    <ProjectAws
      key={`${organizationId}:${projectId}`}
      organizationId={organizationId}
      projectId={projectId}
    />
  );
}

function ProjectAws({ organizationId, projectId }: Scope) {
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const queryClient = useQueryClient();
  const query = useAwsProject({ organizationId, projectId }, !switched);
  if (switched) return null;
  const connection = query.data;
  const settings = connection?.settings;
  return (
    <Page>
      <PageHeader title="การเชื่อมต่อ AWS ของโปรเจกต์" />
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
            <AwsProjectStatus connection={connection} />
            {settings && (
              <>
                <p>
                  {settings.hubConnected
                    ? "เชื่อมบัญชีกลางขององค์กรแล้ว"
                    : "ให้ Owner หรือ Admin ตั้งค่าบัญชีกลางขององค์กรก่อน"}{" "}
                  <Link to={`/organizations/${organizationId}/aws`}>
                    การเชื่อมต่อขององค์กร
                  </Link>
                </p>
                <CopyValue label="External ID" value={settings.externalId} />
                {settings.trustPolicy && (
                  <CopyValue
                    label="นโยบายความเชื่อถือ"
                    value={settings.trustPolicy}
                  />
                )}
                <AwsConnectionForm
                  initialRoleArn={settings.roleArn}
                  canTest={settings.hubConnected}
                  saved={connection.method !== null}
                  affected="โปรเจกต์นี้จะไม่ได้เชื่อมต่อกับ AWS"
                  check={(arn, save, signal) =>
                    checkProjectAws(
                      organizationId,
                      projectId,
                      arn,
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
