import type {
  VulnerabilityComponent,
  VulnerabilityFinding,
  VulnerabilityList,
  VulnerabilityRun,
} from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { useCurrentProject } from "../../components/shell/useCurrentProject";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { HairlineGrid } from "../../components/ui/hairline-grid";
import { Notice } from "../../components/ui/notice";
import { SectionHeader } from "../../components/ui/section-header";
import { StatusPill } from "../../components/ui/status-pill";
import {
  advanceVulnerabilityRun,
  fetchVulnerabilities,
  startVulnerabilityRun,
  systemExportHref,
  vulnerabilityErrorMessage,
  vulnerabilityKeys,
} from "../../lib/api/vulnerabilities";
import { usePreferences, type Preferences } from "../../lib/preferences";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import { formatUploadedAt, NO_SYSTEM_NAME } from "../inventory/format";
import { SamplePanel } from "./SamplePanel";
import { TriageControl } from "./TriageControl";

type Scope = { organizationId: string; projectId: string };

const SOURCE_LABELS = { nvd: "NVD", osv: "OSV" } as const;
const FEED_LABELS = {
  nvd: "NVD",
  osv: "OSV",
  kev: "CISA KEV",
  epss: "EPSS",
} as const;
const SEVERITY_LABELS = {
  critical: "วิกฤต",
  high: "สูง",
  medium: "กลาง",
  low: "ต่ำ",
  none: "ไม่มี",
} as const;
const POLL_MS = 5_000;

export function VulnerabilitiesPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return null;
  const scope = {
    organizationId: organizationId.toLowerCase(),
    projectId: projectId.toLowerCase(),
  };
  return (
    <Vulnerabilities
      key={`${scope.organizationId}:${scope.projectId}`}
      {...scope}
    />
  );
}

function Tile({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: number;
  note: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-2 px-6 py-5" data-testid={testId}>
      <span className="text-[13px] text-foreground-secondary">{label}</span>
      <span className="font-mono text-[28px] leading-8 font-medium text-heading">
        {value}
      </span>
      <span className="text-xs text-foreground-secondary">{note}</span>
    </div>
  );
}

function severityPill(finding: VulnerabilityFinding) {
  if (finding.cvssScore === null) {
    return <span className="text-foreground-secondary">ไม่ทราบ</span>;
  }
  const level = finding.cvssSeverity;
  return (
    <StatusPill
      dot
      neutralLabel
      tone={
        level === "critical" || level === "high"
          ? "danger"
          : level === "medium"
            ? "caution"
            : "muted"
      }
    >
      <span className="font-mono">{finding.cvssScore.toFixed(1)}</span>
      {level === null ? "" : ` ${SEVERITY_LABELS[level]}`}
    </StatusPill>
  );
}

function FindingRow({
  finding,
  triage,
}: {
  finding: VulnerabilityFinding;
  /** The VEX control; absent for a CVE a person cannot triage (filtered as a backport). */
  triage: ReactNode;
}) {
  return (
    <tr
      data-testid={`vuln-finding-${finding.cveId}`}
      className="border-t border-foreground/10 align-top text-sm"
    >
      <td className="px-4 py-2 font-mono text-[13px]">{finding.cveId}</td>
      <td className="px-4 py-2">{severityPill(finding)}</td>
      <td className="px-4 py-2 font-mono text-[13px]">
        {finding.epss === null ? (
          <span className="font-sans text-foreground-secondary">ไม่ทราบ</span>
        ) : (
          `${String(Math.round(finding.epss * 1000) / 10)}%`
        )}
      </td>
      <td className="px-4 py-2">
        {finding.kev === null ? (
          <span className="text-foreground-secondary">ไม่ทราบ</span>
        ) : finding.kev ? (
          "อยู่ใน KEV"
        ) : (
          "ไม่อยู่ใน KEV"
        )}
      </td>
      <td className="px-4 py-2">
        {finding.sources.map((source) => SOURCE_LABELS[source]).join(", ")}
      </td>
      <td className="px-4 py-2 text-[13px]">
        {finding.backport ? (
          <span data-testid={`vuln-backport-${finding.cveId}`}>
            กรองออก (backport) · advisory{" "}
            <span className="font-mono">{finding.advisoryId}</span>
            <span className="block text-foreground-secondary">
              {finding.backportReason}
            </span>
          </span>
        ) : (
          "พบ"
        )}
      </td>
      <td className="px-4 py-2">{triage}</td>
    </tr>
  );
}

function stateNote(
  component: VulnerabilityComponent,
  results: VulnerabilityRun | null,
  preferences: Preferences,
  inventoryPath: string,
) {
  const at = results?.finishedAt
    ? formatUploadedAt(results.finishedAt, preferences)
    : null;
  const checked = component.checkedSources
    .map((source) => SOURCE_LABELS[source])
    .join(", ");
  const partial = component.backportPartial ? (
    <span className="ml-2 text-caution" data-testid="vuln-backport-partial">
      ตรวจ backport ไม่ครบ บาง CVE อาจยังไม่ถูกกรอง
    </span>
  ) : null;
  const note = (content: ReactNode) => (
    <>
      {content}
      {partial}
    </>
  );
  switch (component.state) {
    case "none_found":
      return note(
        <span data-testid="vuln-none-found">
          ไม่พบ CVE ณ feed เวลา <span className="font-mono">{at}</span> (ตรวจ{" "}
          {checked}) ไม่ได้หมายความว่าปลอดภัย
        </span>,
      );
    case "check_failed":
      return (
        <span className="text-caution" data-testid="vuln-check-failed">
          ตรวจไม่สำเร็จ
          {component.failedSources.length === 0
            ? ""
            : ` (${component.failedSources.map((source) => SOURCE_LABELS[source]).join(", ")} ใช้ไม่ได้)`}{" "}
          ผลนี้ไม่ใช่ &quot;ไม่พบ CVE&quot;
        </span>
      );
    case "pending":
      return <span className="text-foreground-secondary">รอตรวจ</span>;
    case "not_covered":
      return (
        <span data-testid="vuln-not-covered">
          ยังไม่ครอบคลุม (ยังไม่มี CPE/purl ที่ยืนยัน){" "}
          <Link
            className="text-primary underline-offset-4 hover:underline"
            to={`${inventoryPath}/mappings`}
          >
            ไปที่คิวยืนยัน
          </Link>
        </span>
      );
    case "backport_only":
      return note(
        <span>CVE ที่พบถูกกรองเป็น backport ทั้งหมด ตรวจเมื่อ {at}</span>,
      );
    case "findings":
      return component.failedSources.length === 0
        ? partial
        : note(
            <span className="text-caution">
              {component.failedSources
                .map((source) => SOURCE_LABELS[source])
                .join(", ")}{" "}
              ใช้ไม่ได้ ผลอาจไม่ครบ
            </span>,
          );
  }
}

function Vulnerabilities({ organizationId, projectId }: Scope) {
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const { preferences } = usePreferences();
  const { project } = useCurrentProject();
  const queryClient = useQueryClient();
  // A new array every render would restart the stepping effect below each time.
  const key = useMemo(
    () => vulnerabilityKeys.list(organizationId, projectId),
    [organizationId, projectId],
  );
  const [stepError, setStepError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [wait, setWait] = useState<number | null>(null);
  // Bumped by "ลองใหม่" so the stepping effect starts again after a failed step.
  const [attempt, setAttempt] = useState(0);
  const looping = useRef<string | null>(null);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      fetchVulnerabilities(organizationId, projectId, signal),
    enabled: !switched,
    retry: false,
    // A member cannot step a run, so the page follows its progress.
    refetchInterval: (current) =>
      current.state.data?.run?.status === "running" &&
      !current.state.data.canManage
        ? POLL_MS
        : false,
  });
  const data = query.data;
  const runId = data?.run?.status === "running" ? data.run.id : null;
  const canManage = data?.canManage === true;

  // An admin's page drives the run: one step, then the next, until it is done. A closed
  // page pauses the run (its state is in the database) and reopening resumes it.
  useEffect(() => {
    if (!canManage || runId === null || looping.current === runId) return;
    looping.current = runId;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = async () => {
      try {
        const advanced = await advanceVulnerabilityRun(
          organizationId,
          projectId,
          runId,
        );
        if (stopped) return;
        setWait(advanced.retryAfterSeconds);
        queryClient.setQueryData(
          key,
          (current: VulnerabilityList | undefined) =>
            current === undefined ? current : { ...current, run: advanced.run },
        );
        if (advanced.run.status === "running") {
          timer = setTimeout(
            () => void step(),
            (advanced.retryAfterSeconds ?? 0) * 1000,
          );
        } else {
          looping.current = null;
          await queryClient.invalidateQueries({ queryKey: key });
        }
      } catch (error) {
        if (stopped) return;
        looping.current = null;
        setStepError(vulnerabilityErrorMessage(error));
      }
    };
    void step();
    return () => {
      stopped = true;
      looping.current = null;
      clearTimeout(timer);
    };
  }, [canManage, runId, organizationId, projectId, queryClient, key, attempt]);

  const start = async () => {
    setStarting(true);
    setStepError(null);
    try {
      await startVulnerabilityRun(organizationId, projectId);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (error) {
      setStepError(vulnerabilityErrorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  if (switched) return null;
  const inventoryPath = `/organizations/${organizationId}/projects/${projectId}/inventory`;
  const vulnerabilitiesPath = `/organizations/${organizationId}/projects/${projectId}/vulnerabilities`;
  const run = data?.run ?? null;
  const systems = new Map<
    string,
    { name: string; components: VulnerabilityComponent[] }
  >();
  for (const component of data?.components ?? []) {
    const entry = systems.get(component.systemId) ?? {
      name: component.system === "" ? NO_SYSTEM_NAME : component.system,
      components: [],
    };
    entry.components.push(component);
    systems.set(component.systemId, entry);
  }

  return (
    <Page>
      <PageHeader
        eyebrow="// vulnerabilities"
        scope={
          project === null
            ? undefined
            : { mark: project.name, label: project.name, tag: "โปรเจกต์" }
        }
        title="ช่องโหว่"
        description="CVE ที่ตรงกับ component ใน inventory ของ Project ข้อมูลมาจากไฟล์ที่ Organization แจ้งเอง ไม่ได้มาจากการตรวจจริง ผลที่ไม่พบ CVE ไม่ได้หมายความว่าปลอดภัย"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link
                data-testid="vuln-priority-link"
                to={`${vulnerabilitiesPath}/priority`}
              >
                ลำดับที่ต้องแก้
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link
                data-testid="vuln-new-link"
                to={`${vulnerabilitiesPath}/new`}
              >
                CVE ใหม่
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link data-testid="vuln-inventory-link" to={inventoryPath}>
                จัดการ inventory
              </Link>
            </Button>
            {canManage ? (
              <Button
                variant="outline"
                data-testid="vuln-run"
                disabled={starting || run?.status === "running"}
                onClick={() => void start()}
              >
                ตรวจ CVE ตอนนี้
              </Button>
            ) : null}
          </>
        }
      />
      <div aria-live="polite" className="space-y-2">
        {run?.status === "running" ? (
          <Notice tone="pending" data-testid="vuln-progress">
            กำลังตรวจ {run.doneUnits} จาก {run.totalUnits} product
            {wait === null ? "" : ` · รอโควตา NVD ${String(wait)} วินาที`}
            {canManage ? " · เปิดหน้านี้ไว้จนกว่าจะเสร็จ" : ""}
          </Notice>
        ) : null}
        {stepError === null ? null : (
          <Alert tone="error" data-testid="vuln-error">
            {stepError}
            {canManage && run?.status === "running" ? (
              <Button
                type="button"
                variant="outline"
                className="ml-3"
                data-testid="vuln-retry"
                onClick={() => {
                  setStepError(null);
                  setAttempt((value) => value + 1);
                }}
              >
                ลองใหม่
              </Button>
            ) : null}
          </Alert>
        )}
        {run?.status === "failed" ? (
          <Alert tone="warning" data-testid="vuln-run-failed">
            การตรวจรอบล่าสุดไม่สำเร็จ {run.failedUnits} product
            ผลที่แสดงเป็นของรอบก่อนหน้า
          </Alert>
        ) : null}
        {run?.status === "done" && run.failedUnits > 0 ? (
          <Alert tone="warning" data-testid="vuln-failed-units">
            ตรวจไม่สำเร็จ {run.failedUnits} product แหล่งข้อมูลบางแห่งใช้ไม่ได้
            ผลของ product เหล่านั้นไม่ครบ
          </Alert>
        ) : null}
      </div>
      {query.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลดช่องโหว่"
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
          {data.results === null ? (
            <p
              className="text-sm text-foreground-secondary"
              data-testid="vuln-no-results"
            >
              ยังไม่มีผลการตรวจ
              {canManage
                ? ' กด "ตรวจ CVE ตอนนี้" เมื่อ inventory ได้รับการยืนยัน CPE/purl แล้ว'
                : ""}
            </p>
          ) : (
            <p
              className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-secondary"
              data-testid="vuln-feeds"
            >
              {(Object.keys(FEED_LABELS) as (keyof typeof FEED_LABELS)[]).map(
                (feed) => {
                  const status = data.results?.feeds[feed];
                  return (
                    <span key={feed}>
                      {FEED_LABELS[feed]}{" "}
                      {status === undefined ? (
                        "ไม่ได้ใช้"
                      ) : (
                        <>
                          <span className="font-mono text-foreground">
                            {formatUploadedAt(status.at, preferences)}
                          </span>
                          {status.ok ? "" : " (ใช้ไม่ได้บางส่วน)"}
                        </>
                      )}
                    </span>
                  );
                },
              )}
            </p>
          )}
          <HairlineGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              testId="vuln-tile-cves"
              label="CVE ที่พบ"
              value={data.summary.cves}
              note={`${String(data.summary.components)} component`}
            />
            <Tile
              testId="vuln-tile-kev"
              label="อยู่ใน KEV"
              value={data.summary.kev}
              note="ถูกใช้โจมตีจริงแล้ว"
            />
            <Tile
              testId="vuln-tile-backport"
              label="กรองเป็น backport"
              value={data.summary.backport}
              note="distro แก้แล้ว (Debian/Ubuntu)"
            />
            <Tile
              testId="vuln-tile-uncovered"
              label="ยังไม่ครอบคลุม"
              value={data.summary.notCovered}
              note={`ตรวจไม่สำเร็จ ${String(data.summary.checkFailed)}`}
            />
          </HairlineGrid>
          <section
            aria-labelledby="vuln-components-heading"
            className="space-y-4"
          >
            <SectionHeader
              id="vuln-components-heading"
              title="component ราย System"
            />
            {systems.size === 0 ? (
              <p className="text-sm text-foreground-secondary">
                ยังไม่มี component ใน inventory{" "}
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  to={inventoryPath}
                >
                  upload inventory
                </Link>
              </p>
            ) : (
              [...systems].map(([systemId, system]) => (
                <div
                  key={systemId}
                  className="overflow-x-auto rounded-md border border-foreground/10 bg-surface"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3">
                    <h3 className="text-sm font-semibold text-heading">
                      {system.name}
                    </h3>
                    <a
                      data-testid={`vuln-export-${systemId}`}
                      href={systemExportHref(
                        organizationId,
                        projectId,
                        systemId,
                      )}
                      className="text-xs text-primary underline-offset-4 hover:underline"
                    >
                      ส่งออก Excel
                      <span className="sr-only"> ของ {system.name}</span>
                    </a>
                  </div>
                  <table className="w-full min-w-[1000px] text-left text-sm">
                    <thead className="text-xs text-foreground-secondary">
                      <tr>
                        {[
                          "CVE",
                          "CVSS",
                          "EPSS",
                          "KEV",
                          "แหล่ง",
                          "สถานะ",
                          "VEX",
                        ].map((head) => (
                          <th
                            key={head}
                            scope="col"
                            className="h-9 px-4 font-medium"
                          >
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    {system.components.map((component) => (
                      <tbody
                        key={`${component.vendor}|${component.product}|${component.version}`}
                        data-testid={`vuln-component-${systemId}-${component.product}-${component.version}`}
                      >
                        <tr className="border-t border-foreground/10 bg-foreground/4">
                          <td
                            colSpan={7}
                            className="px-4 py-2 text-left font-normal"
                          >
                            <span className="font-medium">
                              {component.vendor} · {component.product}
                            </span>{" "}
                            <span className="font-mono text-[13px]">
                              {component.version}
                            </span>
                            <span className="ml-3 text-[13px]">
                              {stateNote(
                                component,
                                data.results,
                                preferences,
                                inventoryPath,
                              )}
                            </span>
                          </td>
                        </tr>
                        {component.findings.map((finding) => (
                          <FindingRow
                            key={finding.cveId}
                            finding={finding}
                            triage={
                              finding.backport ||
                              component.mappingId === null ? (
                                <span className="text-foreground-secondary">
                                  —
                                </span>
                              ) : (
                                <TriageControl
                                  organizationId={organizationId}
                                  projectId={projectId}
                                  canManage={canManage}
                                  target={{
                                    mappingId: component.mappingId,
                                    version: component.version,
                                    cveId: finding.cveId,
                                  }}
                                  triage={finding.triage}
                                />
                              )
                            }
                          />
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
              ))
            )}
          </section>
          <SamplePanel
            scope={{ organizationId, projectId }}
            canManage={canManage}
            hasResults={data.results !== null && data.summary.cves > 0}
          />
        </>
      )}
    </Page>
  );
}
