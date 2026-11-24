import type { VulnerabilityList } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { cn } from "@/lib/utils";
import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { useCurrentProject } from "../../components/shell/useCurrentProject";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { InfoTip } from "../../components/ui/icon-button";
import { Notice } from "../../components/ui/notice";
import {
  advanceVulnerabilityRun,
  fetchNewVulnerabilities,
  fetchPriority,
  fetchVulnerabilities,
  startVulnerabilityRun,
  isVulnerabilityAccessDenied,
  VULNERABILITY_DENIED_MESSAGE,
  vulnerabilityErrorMessage,
  vulnerabilityKeys,
} from "../../lib/api/vulnerabilities";
import { usePreferences } from "../../lib/preferences";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import { formatUploadedAt } from "../inventory/format";
import { BySystem } from "./BySystem";
import { FalsePositiveAlert } from "./FalsePositiveAlert";
import { parseFilters, parseView, toSearch, type FixFilters } from "./filters";
import { FEED_LABELS } from "./format";
import { NeedsFix } from "./NeedsFix";

type Scope = { organizationId: string; projectId: string };

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

const tab = (current: boolean) =>
  cn(
    "-mb-px inline-flex h-10 items-center border-b-2 px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
    current
      ? "border-primary font-medium text-foreground"
      : "border-transparent text-foreground-secondary hover:text-foreground",
  );

function Vulnerabilities({ organizationId, projectId }: Scope) {
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const { preferences } = usePreferences();
  const { project } = useCurrentProject();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const view = parseView(params);
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
  // The ranking and the new-CVE list are the "ต้องแก้" view's; "ราย System" reads the list alone.
  const priorityQuery = useQuery({
    queryKey: vulnerabilityKeys.priority(organizationId, projectId),
    queryFn: ({ signal }) => fetchPriority(organizationId, projectId, signal),
    enabled: !switched && view === "fix",
    retry: false,
  });
  const freshQuery = useQuery({
    queryKey: vulnerabilityKeys.newCves(organizationId, projectId),
    queryFn: ({ signal }) =>
      fetchNewVulnerabilities(organizationId, projectId, signal),
    enabled: !switched && view === "fix",
    retry: false,
  });
  const data = query.data;
  const runId = data?.run?.status === "running" ? data.run.id : null;
  const canManage = data?.canManage === true;

  // A run that ended while this page followed it (a member's page): the ranking and the
  // new-CVE list are older than the list now, so every list of the Project is read again.
  const wasRunning = useRef(false);
  const running = data?.run?.status === "running";
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (running) setFinished(false);
    if (wasRunning.current && !running) {
      setFinished(true);
      void queryClient.invalidateQueries({
        queryKey: vulnerabilityKeys.all(organizationId, projectId),
      });
    }
    wasRunning.current = running;
  }, [running, queryClient, organizationId, projectId]);

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
          await queryClient.invalidateQueries({
            queryKey: vulnerabilityKeys.all(organizationId, projectId),
          });
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
      await queryClient.invalidateQueries({
        queryKey: vulnerabilityKeys.all(organizationId, projectId),
      });
    } catch (error) {
      setStepError(vulnerabilityErrorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  if (switched) return null;
  const base = `/organizations/${organizationId}/projects/${projectId}/vulnerabilities`;
  const inventoryPath = `/organizations/${organizationId}/projects/${projectId}/inventory`;
  const run = data?.run ?? null;
  const results = data?.results ?? null;
  const fresh = freshQuery.data;
  const filters = parseFilters(params);
  // The new-CVE warnings show with that filter; they stand in for the run alerts they repeat.
  const newFilterWarnings =
    view === "fix" && filters.isNew ? (fresh?.warnings ?? []) : [];
  // A system id the Project does not have (a stale link) is dropped, not shown as an empty list.
  const knownSystem = data?.components.some(
    (component) => component.systemId === filters.system,
  );
  const effective: FixFilters =
    filters.system !== null && data !== undefined && knownSystem !== true
      ? { ...filters, system: null }
      : filters;
  const feedDown = results
    ? (Object.keys(FEED_LABELS) as (keyof typeof FEED_LABELS)[]).filter(
        (feed) => results.feeds[feed]?.ok === false,
      )
    : [];
  const feedTip = results
    ? (Object.keys(FEED_LABELS) as (keyof typeof FEED_LABELS)[])
        .map((feed) => {
          const status = results.feeds[feed];
          return `${FEED_LABELS[feed]} ${
            status === undefined
              ? "ไม่ได้ใช้"
              : `${formatUploadedAt(status.at, preferences)}${status.ok ? "" : " (ใช้ไม่ได้)"}`
          }`;
        })
        .join(" · ")
    : "";
  const loading =
    query.isPending ||
    (view === "fix" && (priorityQuery.isPending || freshQuery.isPending));
  // A disabled query keeps its last error, so only the queries this view reads can fail it.
  const active = view === "fix" ? [query, priorityQuery, freshQuery] : [query];
  const failed = active.find((candidate) => candidate.isError);
  const content = (
    <>
      {data === undefined ? null : view === "systems" ? (
        <BySystem
          scope={{ organizationId, projectId }}
          list={data}
          preferences={preferences}
          inventoryPath={inventoryPath}
        />
      ) : priorityQuery.data === undefined || fresh === undefined ? null : (
        <NeedsFix
          scope={{ organizationId, projectId }}
          list={data}
          priority={priorityQuery.data}
          fresh={fresh}
          filters={effective}
          onFilters={(next) => {
            setParams(toSearch("fix", next), { replace: true });
          }}
          preferences={preferences}
          inventoryPath={inventoryPath}
          systemsPath={`${base}?view=systems`}
        />
      )}
    </>
  );

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
        description="CVE ที่ตรงกับ component ใน inventory ของ Project เรียงตามที่ควรแก้ก่อน"
        actions={
          <>
            {canManage ? (
              <Button variant="outline" asChild>
                <Link data-testid="vuln-sample-link" to={`${base}/sample`}>
                  สุ่มตรวจผล
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link data-testid="vuln-inventory-link" to={inventoryPath}>
                จัดการ inventory
              </Link>
            </Button>
          </>
        }
      />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-foreground/10 bg-surface px-4 py-2">
          <div className="min-w-0 space-y-0.5">
            {data === undefined ? null : (
              <div
                className="flex flex-wrap items-center gap-x-1 text-sm"
                data-testid="vuln-status"
              >
                {results === null ? (
                  <span data-testid="vuln-no-results">
                    ยังไม่มีผลการตรวจ
                    {canManage
                      ? ' กด "ตรวจ CVE ตอนนี้" เมื่อ inventory ได้รับการยืนยัน CPE/purl แล้ว'
                      : ""}
                  </span>
                ) : (
                  <>
                    <span>
                      {results.finishedAt === null ? null : (
                        <>
                          <span data-testid="vuln-checked-at">
                            ตรวจล่าสุด{" "}
                            <span className="font-mono">
                              {formatUploadedAt(
                                results.finishedAt,
                                preferences,
                              )}
                            </span>{" "}
                            (
                            <span className="font-mono">
                              {preferences.timeZone}
                            </span>
                            )
                          </span>{" "}
                          ·{" "}
                        </>
                      )}
                      {feedDown.length === 0 ? (
                        "แหล่งข้อมูลครบ"
                      ) : (
                        <span className="text-caution">
                          {feedDown.map((feed) => FEED_LABELS[feed]).join(", ")}{" "}
                          ใช้ไม่ได้
                        </span>
                      )}
                    </span>
                    <InfoTip data-testid="vuln-feeds" label={feedTip} />
                  </>
                )}
              </div>
            )}
            <p
              className="text-xs text-foreground-secondary"
              data-testid="vuln-trust"
            >
              ข้อมูลมาจาก inventory ที่ Organization แจ้งเอง ไม่พบ CVE
              ไม่ได้แปลว่าปลอดภัย
            </p>
          </div>
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
        </div>
        <div className="space-y-2">
          {run?.status === "running" ? (
            <>
              <Notice tone="pending" data-testid="vuln-progress">
                กำลังตรวจ {run.doneUnits} จาก {run.totalUnits} product
                {wait === null ? "" : ` · รอโควตา NVD ${String(wait)} วินาที`}
                {canManage ? " · เปิดหน้านี้ไว้จนกว่าจะเสร็จ" : ""}
              </Notice>
              <div
                role="progressbar"
                aria-label="ความคืบหน้าการตรวจ CVE"
                aria-valuemin={0}
                aria-valuemax={run.totalUnits}
                aria-valuenow={run.doneUnits}
                data-testid="vuln-progressbar"
                className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-foreground/10"
              >
                <div
                  className="h-full bg-foreground-secondary transition-[width]"
                  style={{
                    width: `${String(run.totalUnits === 0 ? 0 : Math.min(100, (run.doneUnits / run.totalUnits) * 100))}%`,
                  }}
                />
              </div>
            </>
          ) : null}
          {finished && run?.status === "done" ? (
            <Notice tone="success" data-testid="vuln-finished">
              ตรวจเสร็จ {run.totalUnits} product
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
          {run?.status === "failed" &&
          !newFilterWarnings.includes("run_failed") ? (
            <Alert tone="warning" data-testid="vuln-run-failed">
              การตรวจรอบล่าสุดไม่สำเร็จ {run.failedUnits} product
              ผลที่แสดงเป็นของรอบก่อนหน้า
            </Alert>
          ) : null}
          {run?.status === "done" &&
          run.failedUnits > 0 &&
          !newFilterWarnings.includes("units_failed") ? (
            <Alert tone="warning" data-testid="vuln-failed-units">
              ตรวจไม่สำเร็จ {run.failedUnits} product
              แหล่งข้อมูลบางแห่งใช้ไม่ได้ ผลของ product เหล่านั้นไม่ครบ
            </Alert>
          ) : null}
          {data?.falsePositive?.overLimit === true &&
          data.falsePositive.falsePositiveRate !== null ? (
            <FalsePositiveAlert
              testId="vuln-fp-warning"
              rate={data.falsePositive.falsePositiveRate}
              reviewed={data.falsePositive.reviewed}
            />
          ) : null}
        </div>
      </div>
      <nav
        aria-label="มุมมองช่องโหว่"
        className="flex gap-1 border-b border-foreground/10"
      >
        <Link
          data-testid="vuln-tab-fix"
          to={base}
          aria-current={view === "fix" ? "page" : undefined}
          className={tab(view === "fix")}
        >
          ต้องแก้
        </Link>
        <Link
          data-testid="vuln-tab-systems"
          to={`${base}?view=systems`}
          aria-current={view === "systems" ? "page" : undefined}
          className={tab(view === "systems")}
        >
          ราย System
        </Link>
      </nav>
      {loading ? (
        <PageState
          kind="loading"
          label="กำลังโหลดช่องโหว่"
          layout="table"
          visibleLabel
        />
      ) : failed !== undefined && isVulnerabilityAccessDenied(failed.error) ? (
        <PageState
          kind="denied"
          data-testid="vuln-denied"
          message={VULNERABILITY_DENIED_MESSAGE}
        />
      ) : failed !== undefined ? (
        <PageState
          kind="error"
          message={vulnerabilityErrorMessage(failed.error)}
          retryLabel="ลองใหม่"
          onRetry={() => {
            for (const candidate of active) {
              if (candidate.isError) void candidate.refetch();
            }
          }}
        />
      ) : (
        content
      )}
    </Page>
  );
}
