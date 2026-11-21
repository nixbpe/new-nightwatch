import type { NewCveList } from "@nightwatch/api-contract";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { useCurrentProject } from "../../components/shell/useCurrentProject";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { StatusPill } from "../../components/ui/status-pill";
import {
  fetchNewVulnerabilities,
  vulnerabilityErrorMessage,
  vulnerabilityKeys,
} from "../../lib/api/vulnerabilities";
import { usePreferences } from "../../lib/preferences";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import { formatUploadedAt } from "../inventory/format";

const WARNING_TEXT: Record<NewCveList["warnings"][number], string> = {
  no_scan: "ยังไม่มีการตรวจที่เสร็จสมบูรณ์ ระบบจะตรวจอัตโนมัติทุก 12 ชั่วโมง",
  run_failed:
    "การตรวจรอบล่าสุดไม่สำเร็จ รายการด้านล่างเป็นผลของรอบที่เสร็จก่อนหน้า",
  feed_down: "แหล่งข้อมูล CVE บางแห่งใช้ไม่ได้ในการตรวจครั้งล่าสุด ผลอาจไม่ครบ",
  stale: "การตรวจล่าสุดเกิน 25 ชั่วโมงแล้ว CVE ที่เพิ่งประกาศอาจยังไม่ปรากฏ",
};
const SEVERITY_LABELS = {
  critical: "วิกฤต",
  high: "สูง",
  medium: "กลาง",
  low: "ต่ำ",
  none: "ไม่มี",
} as const;

export function NewVulnerabilitiesPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return null;
  const scope = {
    organizationId: organizationId.toLowerCase(),
    projectId: projectId.toLowerCase(),
  };
  return (
    <NewVulnerabilities
      key={`${scope.organizationId}:${scope.projectId}`}
      {...scope}
    />
  );
}

function NewVulnerabilities({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const { preferences } = usePreferences();
  const { project } = useCurrentProject();
  const query = useQuery({
    queryKey: vulnerabilityKeys.newCves(organizationId, projectId),
    queryFn: ({ signal }) =>
      fetchNewVulnerabilities(organizationId, projectId, signal),
    enabled: !switched,
    retry: false,
  });
  if (switched) return null;
  const data = query.data;
  const vulnerabilitiesPath = `/organizations/${organizationId}/projects/${projectId}/vulnerabilities`;

  return (
    <Page>
      <PageHeader
        eyebrow="// vulnerabilities"
        scope={
          project === null
            ? undefined
            : { mark: project.name, label: project.name, tag: "โปรเจกต์" }
        }
        title="CVE ใหม่"
        description="CVE ที่การตรวจอัตโนมัติพบครั้งแรกหลังรอบแรกของ Project ย้อนหลัง 30 วัน การตรวจอัตโนมัติรันทุก 12 ชั่วโมง"
        actions={
          <Button variant="outline" asChild>
            <Link data-testid="new-cve-back" to={vulnerabilitiesPath}>
              กลับไปช่องโหว่
            </Link>
          </Button>
        }
      />
      {query.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลด CVE ใหม่"
          layout="table"
          visibleLabel
        />
      ) : query.isError ? (
        <PageState
          kind="error"
          message={vulnerabilityErrorMessage(query.error)}
          retryLabel="ลองใหม่"
          onRetry={() => void query.refetch()}
        />
      ) : data === undefined ? null : (
        <>
          <p
            className="text-xs text-foreground-secondary"
            data-testid="new-cve-checked"
          >
            {data.checkedAt === null ? (
              "ยังไม่มีการตรวจที่เสร็จสมบูรณ์"
            ) : (
              <>
                ตรวจล่าสุดเสร็จเมื่อ{" "}
                <span className="font-mono text-foreground">
                  {formatUploadedAt(data.checkedAt, preferences)}
                </span>
              </>
            )}
          </p>
          <div className="space-y-2">
            {data.warnings.map((warning) => (
              <Alert
                key={warning}
                tone="warning"
                data-testid={`new-cve-warning-${warning}`}
              >
                {WARNING_TEXT[warning]}
              </Alert>
            ))}
          </div>
          {data.items.length === 0 ? (
            data.warnings.length === 0 ? (
              <p className="text-sm" data-testid="new-cve-none">
                ไม่พบ CVE ใหม่ใน {String(data.windowDays)} วันที่ผ่านมา ณ
                การตรวจล่าสุด ไม่ได้หมายความว่าปลอดภัย
              </p>
            ) : null
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-foreground-secondary">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-normal">
                      CVE
                    </th>
                    <th scope="col" className="px-4 py-2 font-normal">
                      Component
                    </th>
                    <th scope="col" className="px-4 py-2 font-normal">
                      พบครั้งแรก
                    </th>
                    <th scope="col" className="px-4 py-2 font-normal">
                      ความรุนแรง
                    </th>
                    <th scope="col" className="px-4 py-2 font-normal">
                      KEV
                    </th>
                    <th scope="col" className="px-4 py-2 font-normal">
                      สถานะ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={`${item.cveId}|${item.vendor}|${item.product}|${item.version}`}
                      data-testid={`new-cve-${item.cveId}`}
                      className="border-t border-foreground/10 align-top"
                    >
                      <td className="px-4 py-2 font-mono text-[13px]">
                        {item.cveId}
                      </td>
                      <td className="px-4 py-2">
                        {item.vendor} · {item.product}{" "}
                        <span className="font-mono text-[13px]">
                          {item.version}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-[13px]">
                        {formatUploadedAt(item.firstSeenAt, preferences)}
                      </td>
                      <td className="px-4 py-2">
                        {item.cvssSeverity === null ? (
                          <span className="text-foreground-secondary">
                            ไม่ทราบ
                          </span>
                        ) : (
                          <StatusPill
                            dot
                            neutralLabel
                            tone={
                              item.cvssSeverity === "critical" ||
                              item.cvssSeverity === "high"
                                ? "danger"
                                : item.cvssSeverity === "medium"
                                  ? "caution"
                                  : "muted"
                            }
                          >
                            {SEVERITY_LABELS[item.cvssSeverity]}
                          </StatusPill>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {item.kev === null ? (
                          <span className="text-foreground-secondary">
                            ไม่ทราบ
                          </span>
                        ) : item.kev ? (
                          "อยู่ใน KEV"
                        ) : (
                          "ไม่อยู่ใน KEV"
                        )}
                      </td>
                      <td className="px-4 py-2 text-[13px]">
                        {item.stillFound
                          ? "ยังพบในการตรวจล่าสุด"
                          : "ไม่พบแล้วในการตรวจล่าสุด"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
