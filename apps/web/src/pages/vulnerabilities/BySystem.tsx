import type {
  VulnerabilityComponent,
  VulnerabilityFinding,
  VulnerabilityList,
} from "@nightwatch/api-contract";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";

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
import { SeverityPill, SOURCE_LABELS, percent } from "./format";
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
          className="text-xs text-danger"
          data-testid={`vuln-export-error-${systemId}`}
        >
          {vulnerabilityErrorMessage(download.error)}
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        data-testid={`vuln-export-${systemId}`}
        disabled={download.isPending}
        onClick={() => {
          download.mutate();
        }}
      >
        ส่งออก Excel
        <span className="sr-only"> ของ {systemName}</span>
      </Button>
    </span>
  );
}

const active = (component: VulnerabilityComponent) =>
  component.findings.filter((finding) => !finding.backport);
const filtered = (component: VulnerabilityComponent) =>
  component.findings.filter((finding) => finding.backport);

function vexText(finding: VulnerabilityFinding) {
  if (finding.triage === null) return "ยังไม่ triage";
  return finding.triage.status === "affected"
    ? "ได้รับผลกระทบ"
    : "ไม่ได้รับผลกระทบ";
}

/** The one badge of a component: what the latest scan says about it, as text. */
function StateBadge({
  component,
  feedTime,
  inventoryPath,
}: {
  component: VulnerabilityComponent;
  feedTime: string | null;
  inventoryPath: string;
}) {
  const checked = component.checkedSources
    .map((source) => SOURCE_LABELS[source])
    .join(", ");
  const failed = component.failedSources
    .map((source) => SOURCE_LABELS[source])
    .join(", ");
  switch (component.state) {
    case "findings":
      return (
        <span data-testid="vuln-found">
          <StatusPill tone="danger" neutralLabel>
            พบ {active(component).length} CVE
          </StatusPill>
          {failed === "" ? null : (
            <span className="ml-2 text-[13px] text-caution">
              {failed} ใช้ไม่ได้ ผลอาจไม่ครบ
            </span>
          )}
        </span>
      );
    case "backport_only":
      return <StatusPill tone="muted">พบเฉพาะ backport</StatusPill>;
    case "none_found":
      return (
        <span data-testid="vuln-none-found">
          <StatusPill tone="primary">ไม่พบ CVE</StatusPill>
          <span className="ml-2 text-[13px] text-foreground-secondary">
            ณ feed เวลา <span className="font-mono">{feedTime}</span> (ตรวจ{" "}
            {checked})
          </span>
        </span>
      );
    case "check_failed":
      return (
        <span data-testid="vuln-check-failed">
          <StatusPill tone="caution">ตรวจไม่สำเร็จ</StatusPill>
          {failed === "" ? null : (
            <span className="ml-2 text-[13px] text-caution">
              {failed} ใช้ไม่ได้
            </span>
          )}
        </span>
      );
    case "pending":
      return <StatusPill tone="muted">รอตรวจ</StatusPill>;
    case "not_covered":
      return (
        <span
          data-testid="vuln-not-covered"
          className="inline-flex flex-wrap items-center gap-2"
        >
          <StatusPill tone="caution">ยังไม่ครอบคลุม</StatusPill>
          <TermTip term="notCovered" />
          <Link
            className="text-[13px] text-primary underline-offset-4 hover:underline"
            to={`${inventoryPath}/mappings`}
          >
            ไปคิวยืนยัน CPE/purl
          </Link>
        </span>
      );
  }
}

function ComponentBlock({
  component,
  feedTime,
  inventoryPath,
}: {
  component: VulnerabilityComponent;
  feedTime: string | null;
  inventoryPath: string;
}) {
  const found = active(component);
  const backports = filtered(component);
  const head = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-sm">
        <span className="font-medium">
          {component.vendor} · {component.product}
        </span>{" "}
        <span className="font-mono text-[13px]">{component.version}</span>
      </span>
      <StateBadge
        component={component}
        feedTime={feedTime}
        inventoryPath={inventoryPath}
      />
      {component.backportPartial ? (
        <StatusPill tone="caution" data-testid="vuln-backport-partial">
          ตรวจ backport ไม่ครบ
        </StatusPill>
      ) : null}
    </span>
  );
  return (
    <div
      data-testid={`vuln-component-${component.systemId}-${component.product}-${component.version}`}
      className="border-t border-foreground/10 first:border-t-0"
    >
      {found.length === 0 ? (
        <div className="px-4 py-3">{head}</div>
      ) : (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="inline-block text-foreground-secondary transition-transform group-open:rotate-90"
            >
              ›
            </span>
            {head}
          </summary>
          <div className="overflow-x-auto px-4 pb-3">
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
                    <td className="py-2 pr-4 font-mono text-[13px]">
                      {finding.cveId}
                    </td>
                    <td className="py-2 pr-4">
                      <SeverityPill
                        score={finding.cvssScore}
                        level={finding.cvssSeverity}
                      />
                    </td>
                    <td className="py-2 pr-4 font-mono text-[13px]">
                      {finding.epss === null ? (
                        <span className="font-sans text-foreground-secondary">
                          ไม่ทราบ
                        </span>
                      ) : (
                        percent(finding.epss)
                      )}
                    </td>
                    <td className="py-2 pr-4">
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
                    <td className="py-2 pr-4">
                      {finding.sources
                        .map((source) => SOURCE_LABELS[source])
                        .join(", ")}
                    </td>
                    <td className="py-2">{vexText(finding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {backports.length === 0 ? null : (
        <details
          className="border-t border-foreground/10 bg-foreground/4"
          data-testid={`vuln-backports-${component.systemId}-${component.product}-${component.version}`}
        >
          <summary className="cursor-pointer px-4 py-2 text-[13px]">
            <span className="inline-flex items-center gap-1">
              กรองเป็น backport {backports.length} รายการ
              <TermTip term="backport" />
            </span>
          </summary>
          <ul className="divide-y divide-foreground/10 px-4 pb-2">
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
  const feedTime = list.results?.finishedAt
    ? formatUploadedAt(list.results.finishedAt, preferences)
    : null;
  if (systems.size === 0) {
    return (
      <p className="text-sm" data-testid="vuln-no-inventory">
        ยังไม่มี component ใน inventory{" "}
        {list.canManage ? (
          <Link
            className="text-primary underline-offset-4 hover:underline"
            to={`${inventoryPath}/import`}
          >
            import inventory
          </Link>
        ) : null}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {[...systems].map(([systemId, system]) => {
        const cves = system.components.flatMap(active);
        return (
          <section
            key={systemId}
            aria-labelledby={`vuln-system-${systemId}`}
            data-testid={`vuln-system-${systemId}`}
            className="overflow-hidden rounded-md border border-foreground/10 bg-surface"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3">
              <div>
                <h3
                  id={`vuln-system-${systemId}`}
                  className="text-sm font-semibold text-heading"
                >
                  {system.name}
                </h3>
                <p className="text-xs text-foreground-secondary">
                  พบ CVE {cves.length} รายการ · อยู่ใน KEV{" "}
                  {cves.filter((finding) => finding.kev === true).length} รายการ
                </p>
              </div>
              <ExportButton
                {...scope}
                systemId={systemId}
                systemName={system.name}
              />
            </div>
            {system.components.map((component) => (
              <ComponentBlock
                key={`${component.vendor}|${component.product}|${component.version}`}
                component={component}
                feedTime={feedTime}
                inventoryPath={inventoryPath}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
