import type {
  VulnerabilityComponent,
  VulnerabilityFinding,
  VulnerabilityList,
} from "@nightwatch/api-contract";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

import { StatusPill } from "../../components/ui/status-pill";
import { Button } from "../../components/ui/button";
import {
  downloadSystemExport,
  vulnerabilityErrorMessage,
} from "../../lib/api/vulnerabilities";
import type { Preferences } from "../../lib/preferences";
import {
  formatUploadedAt,
  NO_SYSTEM_NAME,
  saveBlob,
} from "../inventory/format";
import {
  FOCUS_RING_INSET,
  SeverityPill,
  SOURCE_LABELS,
  STANDALONE_LINK,
  percent,
} from "./format";
import { TermTip } from "./terms";

type Scope = { organizationId: string; projectId: string };

/** One System's findings as Excel; a failed download says so next to the button and keeps the page. */
function ExportButton({
  organizationId,
  projectId,
  systemId,
  systemName,
}: Scope & { systemId: string; systemName: string }) {
  const download = useMutation({
    mutationFn: () => downloadSystemExport(organizationId, projectId, systemId),
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename ?? "vulnerabilities.xlsx");
    },
  });
  return (
    <span className="flex items-center gap-2">
      {download.isError ? (
        <span
          role="alert"
          className="text-xs text-danger"
          data-testid={`vuln-export-error-${systemId}`}
        >
          {vulnerabilityErrorMessage(download.error)}
        </span>
      ) : null}
      {/* Always rendered, so the wait is announced when its text appears. */}
      <span
        role="status"
        className="sr-only"
        data-testid={`vuln-export-status-${systemId}`}
      >
        {download.isPending ? `กำลังสร้างไฟล์ Excel ของ ${systemName}` : ""}
      </span>
      <Button
        type="button"
        variant="outline"
        data-testid={`vuln-export-${systemId}`}
        disabled={download.isPending}
        aria-busy={download.isPending}
        onClick={() => {
          download.mutate();
        }}
      >
        Export Excel
        <span className="sr-only"> ของ {systemName}</span>
      </Button>
    </span>
  );
}

const active = (component: VulnerabilityComponent) =>
  component.findings.filter((finding) => !finding.backport);
const filtered = (component: VulnerabilityComponent) =>
  component.findings.filter((finding) => finding.backport);
/** Findings the count above includes but a Project admin marked not affected (VEX). */
const notAffectedCount = (findings: VulnerabilityFinding[]) =>
  findings.filter((finding) => finding.triage?.status === "not_affected")
    .length;

/** When each match feed last answered, formatted; a source the run never asked is absent. */
type FeedTimes = Partial<Record<keyof typeof SOURCE_LABELS, string>>;

function vexText(finding: VulnerabilityFinding) {
  if (finding.triage === null) return "ยังไม่ triage";
  return finding.triage.status === "affected"
    ? "ได้รับผลกระทบ"
    : "ไม่ได้รับผลกระทบ";
}

const ROW =
  "grid grid-cols-[1rem_minmax(0,1.3fr)_9.5rem_minmax(0,2fr)] items-center gap-x-3 gap-y-1 px-4 py-2 max-lg:grid-cols-[1rem_minmax(0,1fr)_9.5rem]";

/** The state of a component, as two grid cells: one badge, then the detail text. */
function StateCells({
  component,
  feedTimes,
  inventoryPath,
}: {
  component: VulnerabilityComponent;
  feedTimes: FeedTimes;
  inventoryPath: string;
}) {
  const failed = component.failedSources
    .map((source) => SOURCE_LABELS[source])
    .join(", ");
  const detail =
    "text-[13px] text-foreground-secondary max-lg:col-start-2 max-lg:col-span-2";
  switch (component.state) {
    case "findings": {
      const unaffected = notAffectedCount(active(component));
      return (
        <span className="contents" data-testid="vuln-found">
          <span>
            <StatusPill tone="danger" neutralLabel>
              พบ {active(component).length} CVE
            </StatusPill>
          </span>
          <span className={detail}>
            {unaffected === 0 ? null : (
              <span data-testid="vuln-not-affected-count">
                ไม่ได้รับผลกระทบ {unaffected} รายการ
              </span>
            )}
            {failed === "" ? null : (
              <span className="text-caution">
                {unaffected === 0 ? "" : " · "}
                {failed} ใช้ไม่ได้ ผลอาจไม่ครบ
              </span>
            )}
          </span>
        </span>
      );
    }
    case "backport_only":
      return (
        <>
          <span>
            <StatusPill tone="muted">พบเฉพาะ backport</StatusPill>
          </span>
          <span className={detail} />
        </>
      );
    case "none_found":
      return (
        <span className="contents" data-testid="vuln-none-found">
          <span>
            <StatusPill tone="muted">ไม่พบ CVE</StatusPill>
          </span>
          <span className={detail}>
            ตรวจ{" "}
            {component.checkedSources.map((source, index) => (
              <span key={source}>
                {index === 0 ? "" : " · "}
                {SOURCE_LABELS[source]}{" "}
                <span
                  className="font-mono"
                  data-testid={`vuln-feed-time-${source}`}
                >
                  {feedTimes[source] ?? "ไม่ทราบ"}
                </span>
              </span>
            ))}
          </span>
        </span>
      );
    case "check_failed":
      return (
        <span className="contents" data-testid="vuln-check-failed">
          <span>
            <StatusPill tone="caution">ตรวจไม่สำเร็จ</StatusPill>
          </span>
          <span className={cn(detail, "text-caution")}>
            {failed === "" ? null : `${failed} ใช้ไม่ได้`}
          </span>
        </span>
      );
    case "pending":
      return (
        <>
          <span>
            <StatusPill tone="muted">รอตรวจ</StatusPill>
          </span>
          <span className={detail} />
        </>
      );
    case "not_covered":
      return (
        <span className="contents" data-testid="vuln-not-covered">
          <span className="inline-flex items-center gap-1">
            <StatusPill tone="caution">ยังไม่ครอบคลุม</StatusPill>
            <TermTip term="notCovered" />
          </span>
          <span className={detail}>
            <Link className={STANDALONE_LINK} to={`${inventoryPath}/mappings`}>
              ไปคิวยืนยัน CPE/purl
            </Link>
          </span>
        </span>
      );
  }
}

/** The CVEs and the backport line of a component sit under it behind a rule, so they read as its own. */
const NESTED = "ml-7 mr-4 mb-3 border-l border-foreground/10 pl-4";

function ComponentBlock({
  component,
  feedTimes,
  inventoryPath,
}: {
  component: VulnerabilityComponent;
  feedTimes: FeedTimes;
  inventoryPath: string;
}) {
  const found = active(component);
  const backports = filtered(component);
  // The details element keeps its own open state; the chevron follows it from here.
  const [expanded, setExpanded] = useState(false);
  const name = (
    <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
      <span className="font-medium">
        {component.vendor} · {component.product}
      </span>{" "}
      <span className="font-mono text-[13px]">{component.version}</span>
      {component.backportPartial ? (
        <StatusPill
          tone="caution"
          className="ml-2"
          data-testid="vuln-backport-partial"
        >
          ตรวจ backport ไม่ครบ
        </StatusPill>
      ) : null}
    </span>
  );
  const cells = (
    <StateCells
      component={component}
      feedTimes={feedTimes}
      inventoryPath={inventoryPath}
    />
  );
  return (
    <div
      data-testid={`vuln-component-${component.systemId}-${component.product}-${component.version}`}
      className="border-t border-foreground/10 first:border-t-0"
    >
      {found.length === 0 ? (
        <div className={ROW}>
          <span aria-hidden="true" />
          {name}
          {cells}
        </div>
      ) : (
        <details
          onToggle={(event) => {
            setExpanded(event.currentTarget.open);
          }}
        >
          <summary
            className={cn(
              ROW,
              "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
              FOCUS_RING_INSET,
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-block text-foreground-secondary transition-transform",
                expanded && "rotate-90",
              )}
            >
              ›
            </span>
            {name}
            {cells}
          </summary>
          <div className={cn(NESTED, "overflow-x-auto")}>
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-foreground-secondary">
                <tr>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    CVE
                  </th>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    <span className="inline-flex items-center gap-1">
                      ความรุนแรง
                      <TermTip term="cvss" />
                    </span>
                  </th>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    <span className="inline-flex items-center gap-1">
                      EPSS
                      <TermTip term="epss" />
                    </span>
                  </th>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    <span className="inline-flex items-center gap-1">
                      KEV
                      <TermTip term="kev" />
                    </span>
                  </th>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    แหล่งที่ match
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    <span className="inline-flex items-center gap-1">
                      สถานะ VEX
                      <TermTip term="vex" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {found.map((finding) => (
                  <tr
                    key={finding.cveId}
                    data-testid={`vuln-finding-${finding.cveId}`}
                    className="border-t border-foreground/10 align-top"
                  >
                    <td className="py-1.5 pr-4 font-mono text-[13px]">
                      {finding.cveId}
                    </td>
                    <td className="py-1.5 pr-4">
                      <SeverityPill
                        score={finding.cvssScore}
                        level={finding.cvssSeverity}
                      />
                    </td>
                    <td className="py-1.5 pr-4 font-mono text-[13px]">
                      {finding.epss === null ? (
                        <span className="font-sans text-foreground-secondary">
                          ไม่ทราบ
                        </span>
                      ) : (
                        percent(finding.epss)
                      )}
                    </td>
                    <td className="py-1.5 pr-4">
                      {finding.kev === null ? (
                        <span className="text-foreground-secondary">
                          ไม่ทราบ
                        </span>
                      ) : finding.kev ? (
                        "อยู่ใน KEV"
                      ) : (
                        "ไม่อยู่ใน KEV"
                      )}
                    </td>
                    <td className="py-1.5 pr-4">
                      {finding.sources
                        .map((source) => SOURCE_LABELS[source])
                        .join(", ")}
                    </td>
                    <td className="py-1.5">{vexText(finding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {backports.length === 0 ? null : (
        <details
          className={NESTED}
          data-testid={`vuln-backports-${component.systemId}-${component.product}-${component.version}`}
        >
          <summary className="cursor-pointer text-[13px]">
            <span className="inline-flex items-center gap-1">
              กรองเป็น backport {backports.length} รายการ
              <TermTip term="backport" />
            </span>
          </summary>
          <ul className="divide-y divide-foreground/10">
            {backports.map((finding) => (
              <li
                key={finding.cveId}
                data-testid={`vuln-backport-${finding.cveId}`}
                className="py-2 text-[13px]"
              >
                <span className="font-mono">{finding.cveId}</span> · advisory{" "}
                <span className="font-mono">{finding.advisoryId}</span>
                <span className="block text-foreground-secondary">
                  {finding.backportReason}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** One System: a header that folds its components (open at first), with its counts and its Excel. */
function SystemGroup({
  scope,
  systemId,
  name,
  components,
  feedTimes,
  inventoryPath,
}: {
  scope: Scope;
  systemId: string;
  name: string;
  components: VulnerabilityComponent[];
  feedTimes: FeedTimes;
  inventoryPath: string;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const cves = components.flatMap(active);
  const unaffected = notAffectedCount(cves);
  return (
    <section
      data-testid={`vuln-system-${systemId}`}
      className="overflow-hidden rounded-md border border-foreground/10 bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
        <h2 className="min-w-0">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            data-testid={`vuln-system-toggle-${systemId}`}
            onClick={() => {
              setOpen((value) => !value);
            }}
            className="flex min-w-0 items-center gap-3 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-block w-4 text-foreground-secondary transition-transform",
                open && "rotate-90",
              )}
            >
              ›
            </span>
            <span className="min-w-0 text-sm font-semibold text-heading [overflow-wrap:anywhere]">
              {name}
            </span>
            <span className="text-xs text-foreground-secondary">
              พบ CVE <span className="font-mono">{cves.length}</span> รายการ ·
              อยู่ใน KEV{" "}
              <span className="font-mono">
                {cves.filter((finding) => finding.kev === true).length}
              </span>{" "}
              รายการ
              {unaffected === 0 ? null : (
                <span data-testid={`vuln-system-not-affected-${systemId}`}>
                  {" "}
                  · ไม่ได้รับผลกระทบ{" "}
                  <span className="font-mono">{unaffected}</span> รายการ
                </span>
              )}
            </span>
          </button>
        </h2>
        <ExportButton {...scope} systemId={systemId} systemName={name} />
      </div>
      <div id={bodyId} hidden={!open} className="border-t border-foreground/10">
        {components.map((component) => (
          <ComponentBlock
            key={`${component.vendor}|${component.product}|${component.version}`}
            component={component}
            feedTimes={feedTimes}
            inventoryPath={inventoryPath}
          />
        ))}
      </div>
    </section>
  );
}

/** The "ราย System" view: each System with its components, their scan state and findings. */
export function BySystem({
  scope,
  list,
  preferences,
  inventoryPath,
}: {
  scope: Scope;
  list: VulnerabilityList;
  preferences: Preferences;
  inventoryPath: string;
}) {
  const systems = new Map<
    string,
    { name: string; components: VulnerabilityComponent[] }
  >();
  for (const component of list.components) {
    const entry = systems.get(component.systemId) ?? {
      name: component.system === "" ? NO_SYSTEM_NAME : component.system,
      components: [],
    };
    entry.components.push(component);
    systems.set(component.systemId, entry);
  }
  const feedTimes: FeedTimes = {};
  for (const source of Object.keys(SOURCE_LABELS) as (keyof FeedTimes)[]) {
    const at = list.results?.feeds[source]?.at;
    if (at !== undefined) feedTimes[source] = formatUploadedAt(at, preferences);
  }
  if (systems.size === 0) {
    return (
      <p className="text-sm" data-testid="vuln-no-inventory">
        ยังไม่มี component ใน inventory{" "}
        {list.canManage ? (
          <Link className={STANDALONE_LINK} to={`${inventoryPath}/import`}>
            import inventory
          </Link>
        ) : null}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {[...systems].map(([systemId, system]) => (
        <SystemGroup
          key={systemId}
          scope={scope}
          systemId={systemId}
          name={system.name}
          components={system.components}
          feedTimes={feedTimes}
          inventoryPath={inventoryPath}
        />
      ))}
    </div>
  );
}
