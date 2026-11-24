import type { VulnerabilitySample } from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  FALSE_POSITIVE_LIMIT,
  FALSE_POSITIVE_MIN_REVIEWED,
  overFalsePositiveLimit,
} from "@nightwatch/api-contract";

import { EmptyState } from "../../components/shell/EmptyState";
import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { useCurrentProject } from "../../components/shell/useCurrentProject";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { HairlineGrid } from "../../components/ui/hairline-grid";
import { SectionHeader } from "../../components/ui/section-header";
import {
  drawSample,
  fetchSample,
  fetchVulnerabilities,
  reviewSampleItem,
  vulnerabilityErrorMessage,
  vulnerabilityKeys,
} from "../../lib/api/vulnerabilities";
import { ApiError } from "../../lib/api/client";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import { FalsePositiveAlert } from "./FalsePositiveAlert";
import { percent } from "./format";

export function SamplePage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return null;
  const scope = {
    organizationId: organizationId.toLowerCase(),
    projectId: projectId.toLowerCase(),
  };
  return (
    <Sample key={`${scope.organizationId}:${scope.projectId}`} {...scope} />
  );
}

// Numbers and units are monospace; the Thai around them stays in the sans-serif (TYP-04).
function Num({ children }: { children: ReactNode }) {
  return <span className="font-mono">{children}</span>;
}

function Stat({
  testId,
  label,
  value,
  note,
}: {
  testId: string;
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <div className="px-4 py-2" data-testid={testId}>
      <span className="block text-[13px] text-foreground-secondary">
        {label}
      </span>
      <span className="block text-2xl leading-8 font-medium text-heading">
        {value}
      </span>
      {note === undefined ? null : (
        <span className="block text-xs text-foreground-secondary">{note}</span>
      )}
    </div>
  );
}

/** The false-positive baseline: a sample of results, each marked right or wrong, for the Project admin. */
function Sample({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const { project } = useCurrentProject();
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: vulnerabilityKeys.list(organizationId, projectId),
    queryFn: ({ signal }) =>
      fetchVulnerabilities(organizationId, projectId, signal),
    enabled: !switched,
    retry: false,
  });
  const list = listQuery.data;
  const canManage = list?.canManage === true;
  const key = vulnerabilityKeys.sample(organizationId, projectId);
  // A member never asks for the sampled results; the API would answer 403.
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchSample(organizationId, projectId, signal),
    enabled: !switched && canManage,
    retry: false,
  });
  const store = (result: { sample: VulnerabilitySample | null }) => {
    queryClient.setQueryData(key, result);
    // The findings page reads the rate from the list.
    void queryClient.invalidateQueries({
      queryKey: vulnerabilityKeys.list(organizationId, projectId),
    });
  };
  const draw = useMutation({
    mutationFn: () => drawSample(organizationId, projectId),
    onSuccess: store,
  });
  const review = useMutation({
    mutationFn: (input: {
      sampleId: string;
      position: number;
      verdict: "true_positive" | "false_positive";
    }) =>
      reviewSampleItem(
        organizationId,
        projectId,
        input.sampleId,
        input.position,
        input.verdict,
      ),
    onSuccess: store,
  });
  if (switched) return null;
  const vulnerabilitiesPath = `/organizations/${organizationId}/projects/${projectId}/vulnerabilities`;
  const sample = query.data?.sample ?? null;
  const denied =
    list !== undefined &&
    (!canManage ||
      (query.error instanceof ApiError && query.error.status === 403));
  const failure =
    draw.error ?? review.error ?? (query.isError ? query.error : null);
  const announcement = draw.isPending
    ? "กำลังสุ่มรายการ"
    : review.isPending
      ? "กำลังบันทึกผลการตัดสิน"
      : review.isSuccess
        ? "บันทึกผลการตัดสินแล้ว"
        : draw.isSuccess
          ? "สุ่มรายการแล้ว"
          : "";

  return (
    <Page>
      <PageHeader
        eyebrow="// vulnerabilities"
        scope={
          project === null
            ? undefined
            : { mark: project.name, label: project.name, tag: "โปรเจกต์" }
        }
        title="สุ่มตรวจผล"
        description="สุ่มไม่เกิน 50 รายการจากรอบตรวจล่าสุด แล้วระบุว่าแต่ละรายการถูกต้องหรือเป็น false positive เพื่อดูว่าผล match ของ Project คลาดเคลื่อนเท่าไร"
        actions={
          <Button variant="outline" asChild>
            <Link data-testid="vuln-sample-back" to={vulnerabilitiesPath}>
              กลับไปช่องโหว่
            </Link>
          </Button>
        }
      />
      {listQuery.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลดผลสุ่มตรวจ"
          layout="rows"
          visibleLabel
        />
      ) : listQuery.isError ? (
        <PageState
          kind="error"
          message={vulnerabilityErrorMessage(listQuery.error)}
          retryLabel="ลองใหม่"
          onRetry={() => void listQuery.refetch()}
        />
      ) : denied ? (
        <div className="space-y-3" data-testid="vuln-sample-restricted">
          <PageState
            kind="denied"
            tone="info"
            message="หน้านี้สำหรับผู้ดูแล Project เท่านั้น สมาชิกอื่นดูรายการสุ่มตรวจและตัดสินผลไม่ได้"
          />
          {list.falsePositive?.overLimit === true &&
          list.falsePositive.falsePositiveRate !== null ? (
            <FalsePositiveAlert
              testId="vuln-sample-over-limit"
              rate={list.falsePositive.falsePositiveRate}
              reviewed={list.falsePositive.reviewed}
            />
          ) : null}
        </div>
      ) : (
        <section aria-labelledby="vuln-sample-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader
              id="vuln-sample-heading"
              title="ผลสุ่มตรวจ"
              meta="สุ่มไม่เกิน 50 รายการจากรอบล่าสุด"
            />
            <Button
              variant="outline"
              data-testid="vuln-sample-draw"
              disabled={
                list?.results == null ||
                list.summary.cves === 0 ||
                draw.isPending
              }
              onClick={() => {
                review.reset();
                draw.mutate();
              }}
            >
              {draw.isPending ? "กำลังสุ่ม…" : "สุ่มตรวจใหม่"}
            </Button>
          </div>
          <span role="status" className="sr-only">
            {announcement}
          </span>
          {failure === null ? null : (
            <Alert tone="error" data-testid="vuln-sample-error">
              {vulnerabilityErrorMessage(failure)}
            </Alert>
          )}
          {query.isPending ? (
            <PageState
              kind="loading"
              layout="inline"
              label="กำลังโหลดผลสุ่มตรวจ…"
            />
          ) : sample === null ? (
            <EmptyState
              data-testid="vuln-sample-empty"
              title="ยังไม่มีผลสุ่มตรวจ"
            />
          ) : (
            <>
              <HairlineGrid
                className="sm:grid-cols-2 lg:grid-cols-4"
                data-testid="vuln-sample-stats"
              >
                <Stat
                  testId="vuln-sample-stat-reviewed"
                  label="ตรวจแล้ว"
                  value={
                    <>
                      <Num>{sample.reviewed}</Num> จาก <Num>{sample.size}</Num>
                    </>
                  }
                />
                <Stat
                  testId="vuln-sample-stat-fp"
                  label="false positive"
                  value={
                    sample.falsePositiveRate === null ? (
                      "ไม่ทราบ"
                    ) : (
                      <Num>{sample.falsePositives}</Num>
                    )
                  }
                />
                <Stat
                  testId="vuln-sample-stat-rate"
                  label="อัตรา"
                  value={
                    sample.falsePositiveRate === null ? (
                      "ไม่ทราบ"
                    ) : (
                      <Num>{percent(sample.falsePositiveRate)}</Num>
                    )
                  }
                />
                <Stat
                  testId="vuln-sample-stat-limit"
                  label="เกณฑ์"
                  value={
                    <>
                      เกิน <Num>{percent(FALSE_POSITIVE_LIMIT)}</Num>
                    </>
                  }
                  note={`เมื่อตรวจแล้วอย่างน้อย ${String(FALSE_POSITIVE_MIN_REVIEWED)} รายการ`}
                />
              </HairlineGrid>
              {sample.falsePositiveRate !== null &&
              overFalsePositiveLimit(sample) ? (
                <FalsePositiveAlert
                  testId="vuln-sample-over-limit"
                  rate={sample.falsePositiveRate}
                  reviewed={sample.reviewed}
                />
              ) : null}
              <div className="overflow-x-auto rounded-md border border-foreground/10 bg-surface">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs text-foreground-secondary">
                    <tr>
                      <th scope="col" className="w-40 px-4 py-2 font-normal">
                        CVE
                      </th>
                      <th scope="col" className="px-2 py-2 font-normal">
                        Component
                      </th>
                      <th
                        scope="col"
                        className="w-72 px-4 py-2 text-end font-normal"
                      >
                        ผลตัดสิน
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sample.items.map((item) => (
                      <tr
                        key={item.position}
                        data-testid={`vuln-sample-item-${String(item.position)}`}
                        className="border-t border-foreground/10"
                      >
                        <td className="px-4 py-2 font-mono text-[13px]">
                          {item.cveId}
                        </td>
                        <td className="px-2 py-2 break-words text-foreground-secondary">
                          {item.component}
                        </td>
                        <td className="px-4 py-2 text-end">
                          <span className="inline-flex gap-2">
                            {(
                              [
                                ["true_positive", "ถูกต้อง"],
                                ["false_positive", "false positive"],
                              ] as const
                            ).map(([verdict, label]) => (
                              <Button
                                key={verdict}
                                size="sm"
                                variant={
                                  item.verdict === verdict
                                    ? "default"
                                    : "outline"
                                }
                                aria-pressed={item.verdict === verdict}
                                data-testid={`vuln-sample-${verdict}-${String(item.position)}`}
                                disabled={review.isPending}
                                onClick={() => {
                                  draw.reset();
                                  review.mutate({
                                    sampleId: sample.id,
                                    position: item.position,
                                    verdict,
                                  });
                                }}
                              >
                                {label}
                                <span className="sr-only">
                                  {" "}
                                  ของ {item.cveId}
                                </span>
                              </Button>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </Page>
  );
}
