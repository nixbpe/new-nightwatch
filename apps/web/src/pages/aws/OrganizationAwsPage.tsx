import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import {
  awsKeys,
  checkOrganizationAws,
  disconnectOrganizationAws,
  fetchOrganizationAws,
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
  const { me, mePending } = useTenant();
  const role = me?.organizations.find((org) => org.id === organizationId)?.role;
  const canManage = role === "owner" || role === "admin";
  const query = useQuery({
    queryKey: awsKeys.organization(organizationId),
    queryFn: ({ signal }) => fetchOrganizationAws(organizationId, signal),
    enabled: !switched && canManage,
    retry: false,
  });
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
              canTest={connection.trustPolicy !== null}
              saved={connection.roleArn !== null}
              affected={`มี ${String(connection.projects.length)} โปรเจกต์แบบ assume role ที่ต้องตั้งค่าบัญชีกลางและทดสอบใหม่`}
              check={(arn, save, signal) =>
                checkOrganizationAws(organizationId, arn, save, signal)
              }
              disconnect={(signal) =>
                disconnectOrganizationAws(organizationId, signal)
              }
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
