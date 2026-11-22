import type {
  NewCveItem,
  NewCveList,
  PriorityItem,
  PriorityList,
  TriagedItem,
  VulnerabilityList,
} from "@nightwatch/api-contract";
import { Link } from "react-router";

import { cn } from "@/lib/utils";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { StatusPill } from "../../components/ui/status-pill";
import { formatUploadedAt } from "../inventory/format";
import type { Preferences } from "../../lib/preferences";
import { hasFilters, NO_FILTERS, type FixFilters } from "./filters";
import { itemKey, selectFix } from "./fixSelect";
import { PROVISIONAL_LABELS, reasonBadges, SeverityPill } from "./format";
import { TermTip } from "./terms";
import { TriageControl } from "./TriageControl";

type Scope = { organizationId: string; projectId: string };

export const NEW_WARNING_TEXT: Record<NewCveList["warnings"][number], string> =
  {
    no_scan: "ยังไม่มีการตรวจที่เสร็จสมบูรณ์ ระบบจะตรวจอัตโนมัติทุก 12 ชั่วโมง",
    run_failed:
      "การตรวจรอบล่าสุดไม่สำเร็จ รายการด้านล่างเป็นผลของรอบที่เสร็จก่อนหน้า",
    units_failed:
      "การตรวจรอบล่าสุดตรวจ product บางตัวไม่สำเร็จ CVE ของ product เหล่านั้นอาจยังไม่ปรากฏ",
    feed_down:
      "แหล่งข้อมูล CVE บางแห่งใช้ไม่ได้ในการตรวจครั้งล่าสุด ผลอาจไม่ครบ",
    stale: "การตรวจล่าสุดเกิน 25 ชั่วโมงแล้ว CVE ที่เพิ่งประกาศอาจยังไม่ปรากฏ",
  };

const chip = (pressed: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    pressed
      ? "border-primary bg-primary-tint text-primary"
      : "border-control-border bg-surface text-foreground hover:surface-hover",
  );

function Tile({
  testId,
  label,
  value,
  pressed,
  term,
  onClick,
}: {
  testId: string;
  label: string;
  value: number;
  pressed: boolean;
  term?: "kev";
  onClick: () => void;
}) {
  return (
    <div className="relative" data-testid={testId}>
      <button
        type="button"
        aria-pressed={pressed}
        onClick={onClick}
        className={cn(
          "flex w-full flex-col gap-1 px-5 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
          pressed ? "bg-primary-tint" : "hover:surface-hover",
        )}
      >
        <span className="text-[13px] text-foreground-secondary">{label}</span>
        <span className="font-mono text-[28px] leading-8 font-medium text-heading">
          {value}
        </span>
      </button>
      {term === undefined ? null : (
        <span className="absolute top-3 right-3">
          <TermTip term={term} />
        </span>
      )}
    </div>
  );
}

function ComponentCell({ item }: { item: PriorityItem | TriagedItem }) {
  return (
    <span className="block text-[13px]">
      {item.vendor} · {item.product}{" "}
      <span className="font-mono">{item.version}</span>
      <span className="block text-foreground-secondary">{item.system}</span>
    </span>
  );
}

function NewBadge({
  firstSeen,
  preferences,
}: {
  firstSeen: string | undefined;
  preferences: Preferences;
}) {
  if (firstSeen === undefined) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground-secondary">
      <StatusPill tone="primary" data-testid="vuln-new-badge">
        ใหม่
      </StatusPill>
      พบครั้งแรก{" "}
      <span className="font-mono text-foreground">
        {formatUploadedAt(firstSeen, preferences)}
      </span>
    </span>
  );
}

function GroupItem({
  item,
  preferences,
  testId,
}: {
  item: NewCveItem;
  preferences: Preferences;
  testId: string;
}) {
  return (
    <li
      data-testid={testId}
      className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm"
    >
      <span>
        <span className="font-mono text-[13px]">{item.cveId}</span>{" "}
        {item.vendor} · {item.product}{" "}
        <span className="font-mono text-[13px]">{item.version}</span>
        <span className="block text-xs text-foreground-secondary">
          พบครั้งแรก{" "}
          <span className="font-mono text-foreground">
            {formatUploadedAt(item.firstSeenAt, preferences)}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-3 text-[13px]">
        <SeverityPill score={null} level={item.cvssSeverity} />
        {item.kev === null ? (
          <span className="text-foreground-secondary">KEV ไม่ทราบ</span>
        ) : item.kev ? (
          "อยู่ใน KEV"
        ) : (
          "ไม่อยู่ใน KEV"
        )}
      </span>
    </li>
  );
}

const th = "px-4 py-2 text-left font-normal";

/** The "ต้องแก้" view: what to fix first, with the filters of the URL. */
export function NeedsFix({
  scope,
  list,
  priority,
  fresh,
  filters,
  onFilters,
  preferences,
  inventoryPath,
  systemsPath,
}: {
  scope: Scope;
  list: VulnerabilityList;
  priority: PriorityList;
  fresh: NewCveList;
  filters: FixFilters;
  onFilters: (next: FixFilters) => void;
  preferences: Preferences;
  inventoryPath: string;
  systemsPath: string;
}) {
  const view = selectFix(priority, list, fresh, filters);
  const systems = [
    ...new Map(list.components.map((c) => [c.systemId, c.system])).entries(),
  ];
  const active = hasFilters(filters);
  const toggle = (key: "isNew" | "kev" | "severe" | "untriaged") => {
    onFilters({ ...filters, [key]: !filters[key] });
  };
  const uncovered = list.summary.notCovered + list.summary.checkFailed;
  const noMatch =
    view.ranked.length === 0 &&
    view.notAffected.length === 0 &&
    view.gone.length === 0 &&
    view.unknown.length === 0;
  const warned = fresh.warnings.length > 0;

  return (
    <div className="space-y-4">
      <div
        className="grid gap-px overflow-hidden rounded-md border border-foreground/10 bg-foreground/10 *:bg-surface sm:grid-cols-2 lg:grid-cols-4"
        data-testid="vuln-tiles"
      >
        <Tile
          testId="vuln-tile-fix"
          label="ต้องแก้"
          value={view.tiles.fix}
          pressed={!active}
          onClick={() => {
            onFilters(NO_FILTERS);
          }}
        />
        <Tile
          testId="vuln-tile-kev"
          label="อยู่ใน KEV"
          value={view.tiles.kev}
          term="kev"
          pressed={filters.kev}
          onClick={() => {
            toggle("kev");
          }}
        />
        <Tile
          testId="vuln-tile-severe"
          label="ความรุนแรงวิกฤตหรือสูง"
          value={view.tiles.severe}
          pressed={filters.severe}
          onClick={() => {
            toggle("severe");
          }}
        />
        <Tile
          testId="vuln-tile-new"
          label="ใหม่ใน 30 วัน"
          value={view.tiles.fresh}
          pressed={filters.isNew}
          onClick={() => {
            toggle("isNew");
          }}
        />
      </div>
      {uncovered === 0 ? null : (
        <p
          className="flex flex-wrap items-center gap-x-2 text-sm"
          data-testid="vuln-coverage"
        >
          <span>
            ยังไม่ครอบคลุม {list.summary.notCovered} component · ตรวจไม่สำเร็จ{" "}
            {list.summary.checkFailed} component
          </span>
          <TermTip term="notCovered" />
          <Link
            data-testid="vuln-coverage-link"
            className="text-primary underline-offset-4 hover:underline"
            to={systemsPath}
          >
            ดูในราย System
          </Link>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs text-foreground-secondary">ตัวกรอง</span>
        <label className="sr-only" htmlFor="vuln-filter-system">
          System
        </label>
        <select
          id="vuln-filter-system"
          data-testid="vuln-filter-system"
          value={filters.system ?? ""}
          onChange={(event) => {
            onFilters({ ...filters, system: event.target.value || null });
          }}
          className="h-8 rounded-md border border-control-border bg-surface px-2 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <option value="">ทุก System</option>
          {systems.map(([id, name]) => (
            <option key={id} value={id}>
              {name === "" ? "(ไม่ระบุชื่อ System)" : name}
            </option>
          ))}
        </select>
        <div role="group" aria-label="ตัวกรอง" className="flex flex-wrap gap-2">
          {(
            [
              ["isNew", "ใหม่ใน 30 วัน", "new"],
              ["kev", "อยู่ใน KEV", "kev"],
              ["untriaged", "ยังไม่ triage", "untriaged"],
            ] as const
          ).map(([key, label, id]) => (
            <button
              key={key}
              type="button"
              data-testid={`vuln-filter-${id}`}
              aria-pressed={filters[key]}
              className={chip(filters[key])}
              onClick={() => {
                toggle(key);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="vuln-filter-clear"
            onClick={() => {
              onFilters(NO_FILTERS);
            }}
          >
            ล้างตัวกรอง
          </Button>
        ) : null}
      </div>
      {filters.isNew ? (
        <div className="space-y-2" data-testid="vuln-new-notes">
          {fresh.warnings.map((warning) => (
            <Alert
              key={warning}
              tone="warning"
              data-testid={`vuln-new-warning-${warning}`}
            >
              {NEW_WARNING_TEXT[warning]}
            </Alert>
          ))}
          {fresh.truncated ? (
            <Alert tone="warning" data-testid="vuln-new-truncated">
              มี CVE ใหม่มากกว่าที่แสดง แสดงเฉพาะรายการล่าสุด
            </Alert>
          ) : null}
          <p
            className="text-sm text-foreground-secondary"
            data-testid="vuln-new-total"
          >
            CVE ใหม่ใน {fresh.windowDays} วัน {view.newTotal} รายการ
          </p>
        </div>
      ) : null}
      {list.summary.components === 0 ? (
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
      ) : list.results === null ? (
        <p
          className="text-sm text-foreground-secondary"
          data-testid="vuln-none"
        >
          รายการที่ต้องแก้จะแสดงที่นี่หลังการตรวจครั้งแรก
        </p>
      ) : !active && view.empty ? (
        <p className="text-sm" data-testid="vuln-none">
          ไม่มี CVE ที่ยังพบ ณ การตรวจล่าสุด ไม่ได้หมายความว่าปลอดภัย
        </p>
      ) : noMatch ? (
        <div className="space-y-2" data-testid="vuln-no-match">
          <p className="text-sm">ไม่มีรายการตามตัวกรอง</p>
          {filters.isNew && !warned ? (
            <p
              className="text-sm text-foreground-secondary"
              data-testid="vuln-new-none"
            >
              ไม่พบ CVE ใหม่ใน {fresh.windowDays} วันที่ผ่านมา ณ การตรวจล่าสุด
              ไม่ได้หมายความว่าปลอดภัย
            </p>
          ) : null}
        </div>
      ) : null}
      {view.ranked.length === 0 ? null : (
        <div className="overflow-x-auto rounded-md border border-foreground/10 bg-surface">
          <table
            className="w-full min-w-[960px] text-sm"
            data-testid="vuln-ranked"
          >
            <thead className="text-xs text-foreground-secondary">
              <tr>
                <th scope="col" className={th}>
                  ลำดับ
                </th>
                <th scope="col" className={th}>
                  CVE และ component
                </th>
                <th scope="col" className={th}>
                  <span className="inline-flex items-center gap-1">
                    ความรุนแรง
                    <TermTip term="cvss" />
                  </span>
                </th>
                <th scope="col" className={th}>
                  <span className="inline-flex items-center gap-1">
                    เหตุผลของลำดับ
                    <TermTip term="kev" />
                    <TermTip term="epss" />
                  </span>
                </th>
                <th scope="col" className={th}>
                  <span className="inline-flex items-center gap-1">
                    สถานะ VEX
                    <TermTip term="vex" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {view.ranked.map((item) => (
                <tr
                  key={`${item.cveId}|${item.systemId}|${item.vendor}|${item.product}|${item.version}`}
                  data-testid={`vuln-item-${String(item.rank)}`}
                  className="border-t border-foreground/10 align-top"
                >
                  <td className="px-4 py-3 font-mono">{item.rank}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[13px]">{item.cveId}</span>
                    <ComponentCell item={item} />
                    <NewBadge
                      firstSeen={view.firstSeen.get(itemKey(item))}
                      preferences={preferences}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <SeverityPill
                      score={item.cvssScore}
                      level={item.cvssSeverity}
                    />
                  </td>
                  <td
                    className="px-4 py-3"
                    data-testid={`vuln-reason-${String(item.rank)}`}
                  >
                    <span className="flex flex-wrap gap-1.5">
                      {reasonBadges(item).map((reason) => (
                        <StatusPill key={reason} tone="muted">
                          {reason}
                        </StatusPill>
                      ))}
                    </span>
                    {item.provisional.length > 0 ? (
                      <span
                        className="mt-1 block text-[13px] text-caution"
                        data-testid={`vuln-provisional-${String(item.rank)}`}
                      >
                        ชั่วคราว: ยังไม่ทราบ{" "}
                        {item.provisional
                          .map((value) => PROVISIONAL_LABELS[value])
                          .join(", ")}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {item.mappingId === null ? null : (
                      <TriageControl
                        {...scope}
                        canManage={list.canManage}
                        target={{
                          mappingId: item.mappingId,
                          version: item.version,
                          cveId: item.cveId,
                        }}
                        triage={item.triage}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.notAffected.length === 0 ? null : (
        <details
          className="rounded-md border border-foreground/10 bg-surface"
          data-testid="vuln-not-affected"
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            ไม่ได้รับผลกระทบ (VEX) {view.notAffected.length} รายการ อยู่นอกลำดับ
          </summary>
          <ul className="divide-y divide-foreground/10">
            {view.notAffected.map((item) => (
              <li
                key={`${item.cveId}|${item.systemId}|${item.vendor}|${item.product}|${item.version}`}
                data-testid={`vuln-not-affected-${item.cveId}`}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm"
              >
                <span>
                  <span className="font-mono text-[13px]">{item.cveId}</span>{" "}
                  <ComponentCell item={item} />
                  <NewBadge
                    firstSeen={view.firstSeen.get(itemKey(item))}
                    preferences={preferences}
                  />
                </span>
                {item.mappingId === null ? null : (
                  <TriageControl
                    {...scope}
                    canManage={list.canManage}
                    target={{
                      mappingId: item.mappingId,
                      version: item.version,
                      cveId: item.cveId,
                    }}
                    triage={item.triage}
                  />
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {view.gone.length === 0 ? null : (
        <details
          className="rounded-md border border-foreground/10 bg-surface"
          data-testid="vuln-new-gone"
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            ใหม่แต่ไม่พบแล้ว {view.gone.length} รายการ
          </summary>
          <ul className="divide-y divide-foreground/10">
            {view.gone.map((item) => (
              <GroupItem
                key={itemKey(item)}
                item={item}
                preferences={preferences}
                testId={`vuln-new-gone-${item.cveId}`}
              />
            ))}
          </ul>
        </details>
      )}
      {view.unknown.length === 0 ? null : (
        <details
          className="rounded-md border border-foreground/10 bg-surface"
          data-testid="vuln-new-unknown"
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            ใหม่แต่ยังไม่ทราบสถานะ {view.unknown.length} รายการ
          </summary>
          <p className="px-4 pb-2 text-xs text-foreground-secondary">
            รอบล่าสุดไม่มีผลตรวจ product ของรายการเหล่านี้
          </p>
          <ul className="divide-y divide-foreground/10">
            {view.unknown.map((item) => (
              <GroupItem
                key={itemKey(item)}
                item={item}
                preferences={preferences}
                testId={`vuln-new-unknown-${item.cveId}`}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
