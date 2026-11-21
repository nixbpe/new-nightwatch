import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import {
  awsKeys,
  checkOrganizationAws,
  disconnectOrganizationAws,
  fetchOrganizationAws,
  isAwsAccessDenied,
} from "../../lib/api/aws";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import {
  AwsConnectionForm,
  awsRequestError,
  CopyValue,
} from "./AwsConnectionForm";

export function OrganizationAwsPage() {
  const { organizationId } = useParams();
  if (!organizationId) return null;
  const id = organizationId.toLowerCase();
  return <OrganizationAws key={id} organizationId={id} />;
}

function OrganizationAws({ organizationId }: { organizationId: string }) {
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const queryClient = useQueryClient();
  const { me, mePending, refreshMembershipContext } = useTenant();
  const role = me?.organizations.find((org) => org.id === organizationId)?.role;
  const canManage = role === "owner" || role === "admin";
  const queryKey = awsKeys.organization(organizationId);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchOrganizationAws(organizationId, signal),
    // A cached denial stops automatic refetches (mount, focus, invalidation):
    // the shell remounts this page while the context reloads, and a context
    // that still says Owner must not repeat the request.
    enabled: (cached) =>
      !switched && canManage && !isAwsAccessDenied(cached.state.error),
    retry: false,
  });
  // A denial refreshes the context so the menu entry goes away (AC-08). Only
  // one that arrived while this page was mounted counts: a cached one was
  // handled by whoever stored it (the route loader or an earlier mount).
  const [errorsAtMount] = useState(
    () => queryClient.getQueryState(queryKey)?.errorUpdateCount ?? 0,
  );
  const freshDenial =
    isAwsAccessDenied(query.error) && query.errorUpdateCount > errorsAtMount;
  useEffect(() => {
    if (freshDenial) void refreshMembershipContext();
  }, [freshDenial, refreshMembershipContext]);
  if (switched) return null;
  const connection = query.data;
  return (
    <Page>
      <PageHeader title="การเชื่อมต่อ AWS ขององค์กร" />
      {mePending ? (
        <p role="status">กำลังตรวจสอบสิทธิ์…</p>
      ) : !canManage ? (
        <Alert tone="error" role="alert">
          คุณเข้าถึงการเชื่อมต่อนี้ไม่ได้
        </Alert>
      ) : query.isPending ? (
        <p role="status">กำลังโหลดการเชื่อมต่อ AWS…</p>
      ) : query.isError && (!connection || isAwsAccessDenied(query.error)) ? (
        <Alert tone="error" role="alert">
          {awsRequestError(query.error)}{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            ลองใหม่
          </Button>
        </Alert>
      ) : (
        connection && (
          <div className="space-y-6">
            {query.isError && (
              // A failed refetch keeps the form and its draft (AC-07, AC-11).
              <Alert tone="error" role="alert" data-testid="aws-refresh-error">
                โหลดข้อมูลล่าสุดไม่สำเร็จ ข้อมูลด้านล่างอาจไม่ใช่สถานะปัจจุบัน{" "}
                <Button variant="outline" onClick={() => void query.refetch()}>
                  ลองใหม่
                </Button>
              </Alert>
            )}
            <p>
              {connection.accountId
                ? `บัญชี AWS ${connection.accountId}`
                : "ยังไม่ได้เชื่อมต่อ"}
            </p>
            <CopyValue label="External ID" value={connection.externalId} />
            {connection.trustPolicy ? (
              <>
                <p>
                  เพิ่มนโยบายความเชื่อถือนี้ใน role ของบัญชีกลาง แล้วนำ Role ARN
                  มาทดสอบ
                </p>
                <CopyValue
                  label="นโยบายความเชื่อถือ"
                  value={connection.trustPolicy}
                />
              </>
            ) : (
              <Alert tone="warning">
                ยังไม่ได้ตั้งค่าตัวตนของ NightWatch สำหรับบัญชีกลาง
              </Alert>
            )}
            <AwsConnectionForm
              initialRoleArn={connection.roleArn}
              revision={connection.revision}
              canTest={connection.trustPolicy !== null}
              saved={connection.roleArn !== null}
              affected={`มี ${String(connection.projects.length)} โปรเจกต์แบบ assume role ที่ต้องตั้งค่าบัญชีกลางและทดสอบใหม่`}
              check={(arn, save, signal) =>
                checkOrganizationAws(
                  organizationId,
                  arn,
                  connection.revision,
                  save,
                  signal,
                )
              }
              disconnect={(signal) =>
                disconnectOrganizationAws(
                  organizationId,
                  connection.revision,
                  signal,
                )
              }
              onDenied={() => void refreshMembershipContext()}
              changed={() =>
                queryClient.invalidateQueries({
                  queryKey: awsKeys.all(organizationId),
                })
              }
            />
            <section className="space-y-2">
              <h2 className="font-semibold">โปรเจกต์ที่ใช้บัญชีกลาง</h2>
              {connection.projects.length === 0 ? (
                <p>ยังไม่มีโปรเจกต์ที่ใช้บัญชีกลาง</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th scope="col">โปรเจกต์</th>
                        <th scope="col">บัญชี AWS</th>
                        <th scope="col">Role ARN</th>
                        <th scope="col">ผลทดสอบล่าสุด</th>
                      </tr>
                    </thead>
                    <tbody>
                      {connection.projects.map((project) => (
                        <tr key={project.projectId}>
                          <th scope="row">
                            <Link
                              to={`/organizations/${organizationId}/projects/${project.projectId}/overview`}
                            >
                              {project.name}
                            </Link>
                          </th>
                          <td>{project.accountId}</td>
                          <td className="break-all">{project.roleArn}</td>
                          <td>
                            {project.current
                              ? "ผ่าน"
                              : "ต้องทดสอบใหม่ · ผลเดิม: ผ่าน"}{" "}
                            ·{" "}
                            <time dateTime={project.lastTestAt}>
                              {new Date(project.lastTestAt).toLocaleString(
                                "th-TH",
                              )}
                            </time>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )
      )}
    </Page>
  );
}
