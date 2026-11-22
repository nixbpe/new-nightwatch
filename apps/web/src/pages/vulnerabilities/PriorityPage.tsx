import type { PriorityItem } from "@nightwatch/api-contract";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { useCurrentProject } from "../../components/shell/useCurrentProject";
import { Button } from "../../components/ui/button";
import { StatusPill } from "../../components/ui/status-pill";
import {
  fetchPriority,
  vulnerabilityErrorMessage,
  vulnerabilityKeys,
} from "../../lib/api/vulnerabilities";
import { usePreferences } from "../../lib/preferences";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import { formatUploadedAt } from "../inventory/format";

const SEVERITY_LABELS = {
  critical: "วิกฤต",
  high: "สูง",
  medium: "กลาง",
  low: "ต่ำ",
  none: "ไม่มี",
} as const;
const EXPOSURE_LABELS = {
  "Internet-facing": "เปิดสู่อินเทอร์เน็ต",
  Internal: "ภายใน",
  Isolated: "แยกเครือข่าย",
} as const;
const PROVISIONAL_LABELS = {
  kev: "KEV",
  epss: "EPSS",
  cvss: "CVSS",
} as const;

/** The reasons of the place, in the order the rule applies them, with the values behind them. */
function reasonText(item: PriorityItem): string {
  return item.reasons
    .map((reason) => {
      switch (reason) {
        case "kev":
          return "อยู่ใน KEV";
        case "exposure":
          return EXPOSURE_LABELS[item.exposure];
        case "epss":
          return `EPSS ${String(Math.round((item.epss ?? 0) * 1000) / 10)}%`;
        case "cvss":
          return `CVSS ${(item.cvssScore ?? 0).toFixed(1)}`;
      }
    })
    .join(" · ");
}

export function PriorityPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return null;
  const scope = {
    organizationId: organizationId.toLowerCase(),
    projectId: projectId.toLowerCase(),
  };
  return (
    <Priority key={`${scope.organizationId}:${scope.projectId}`} {...scope} />
  );
}

function Priority({
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
    queryKey: vulnerabilityKeys.priority(organizationId, projectId),
    queryFn: ({ signal }) => fetchPriority(organizationId, projectId, signal),
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
        title="ลำดับที่ต้องแก้"
        description="CVE ที่ยังพบของ Project เรียงตาม KEV ก่อน แล้วการเปิดสู่ภายนอก แล้ว EPSS มากไปน้อย โดย CVSS ตัดสินเมื่อเท่ากัน รายการที่ยังไม่มีค่า EPSS หรือ CVSS อยู่บนสุดของกลุ่มและติดป้าย 'ชั่วคราว' จนกว่าจะมีค่า"
        actions={
          <Button variant="outline" asChild>
            <Link data-testid="priority-back" to={vulnerabilitiesPath}>
              กลับไปช่องโหว่
            </Link>
          </Button>
        }
      />
      {query.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลดลำดับที่ต้องแก้"
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
            data-testid="priority-checked"
          >
            {data.checkedAt === null ? (
              "ยังไม่มีการตรวจที่เสร็จสมบูรณ์"
            ) : (
              <>
                จากการตรวจที่เสร็จเมื่อ{" "}
                <span className="font-mono text-foreground">
                  {formatUploadedAt(data.checkedAt, preferences)}
                </span>
              </>
            )}
          </p>
          {data.items.length === 0 ? (
            <p className="text-sm" data-testid="priority-none">
              {data.checkedAt === null
                ? "ตรวจ CVE ที่หน้าช่องโหว่ก่อน แล้วลำดับจะแสดงที่นี่"
                : "ไม่มี CVE ที่ยังพบ ณ การตรวจล่าสุด ไม่ได้หมายความว่าปลอดภัย component ที่ตรวจไม่สำเร็จหรือยังไม่ครอบคลุมดูได้ที่หน้าช่องโหว่"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="text-xs text-foreground-secondary">
                  <tr>
                    {[
                      "ลำดับ",
                      "CVE",
                      "Component",
                      "System",
                      "ความรุนแรง",
                      "เหตุผลของลำดับ",
                    ].map((head) => (
                      <th
                        key={head}
                        scope="col"
                        className="px-4 py-2 font-normal"
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={String(item.rank)}
                      data-testid={`priority-item-${String(item.rank)}`}
                      className="border-t border-foreground/10 align-top"
                    >
                      <td className="px-4 py-2 font-mono">{item.rank}</td>
                      <td className="px-4 py-2 font-mono text-[13px]">
                        {item.cveId}
                      </td>
                      <td className="px-4 py-2">
                        {item.vendor} · {item.product}{" "}
                        <span className="font-mono text-[13px]">
                          {item.version}
                        </span>
                      </td>
                      <td className="px-4 py-2">{item.system}</td>
                      <td className="px-4 py-2">
                        {item.cvssScore === null ? (
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
                            <span className="font-mono">
                              {item.cvssScore.toFixed(1)}
                            </span>
                            {item.cvssSeverity === null
                              ? ""
                              : ` ${SEVERITY_LABELS[item.cvssSeverity]}`}
                          </StatusPill>
                        )}
                      </td>
                      <td
                        className="px-4 py-2 text-[13px]"
                        data-testid={`priority-reason-${String(item.rank)}`}
                      >
                        {reasonText(item)}
                        {item.provisional.length > 0 ? (
                          <span
                            className="ml-2 text-caution"
                            data-testid={`priority-provisional-${String(item.rank)}`}
                          >
                            ชั่วคราว: ยังไม่ทราบ{" "}
                            {item.provisional
                              .map((value) => PROVISIONAL_LABELS[value])
                              .join(", ")}
                          </span>
                        ) : null}
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
