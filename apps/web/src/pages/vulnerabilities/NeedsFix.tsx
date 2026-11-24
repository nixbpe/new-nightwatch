import type {
  NewCveItem,
  NewCveList,
  PriorityItem,
  PriorityList,
  TriagedItem,
  VulnerabilityList,
} from "@nightwatch/api-contract";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";
import { EmptyState } from "../../components/shell/EmptyState";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { HairlineGrid } from "../../components/ui/hairline-grid";
import { Select } from "../../components/ui/select";
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
          "flex w-full flex-col px-4 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
          pressed ? "bg-primary-tint" : "hover:surface-hover",
        )}
      >
        <span className="text-[13px] text-foreground-secondary">{label}</span>
        <span className="font-mono text-2xl leading-8 font-medium text-heading">
          {value}
        </span>
      </button>
      {term === undefined ? null : (
        <span className="absolute top-1.5 right-2">
          <TermTip term={term} />
        </span>
      )}
    </div>
  );
}

/** The columns of every list on this view, so the folded groups line up with the ranking. */
function Cols() {
  return (
    <colgroup>
      <col style={{ width: 56 }} />
      <col style={{ width: "32%" }} />
      <col style={{ width: 120 }} />
      <col />
      <col style={{ width: 232 }} />
    </colgroup>
  );
}

const td = "px-2 py-2 align-top [overflow-wrap:anywhere]";

function CveCell({
  cveId,
  vendor,
  product,
  version,
  system,
  firstSeen,
  preferences,
}: {
  cveId: string;
  vendor: string;
  product: string;
  version: string;
  system: string | null;
  firstSeen: string | undefined;
  preferences: Preferences;
}) {
  return (
    <td className={td}>
      <span className="block font-mono text-[13px]">{cveId}</span>
      <span className="block text-[13px]">
        {vendor} · {product} <span className="font-mono">{version}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-foreground-secondary">
        {system === null ? null : <span>{system}</span>}
        {firstSeen === undefined ? null : (
          <>
            <StatusPill tone="primary" data-testid="vuln-new-badge">
              ใหม่
            </StatusPill>
            <span>
              พบครั้งแรก{" "}
              <span className="font-mono text-foreground">
                {formatUploadedAt(firstSeen, preferences)}
              </span>
            </span>
          </>
        )}
      </span>
    </td>
  );
}

function Vex({
  scope,
  canManage,
  item,
}: {
  scope: Scope;
  canManage: boolean;
  item: PriorityItem | TriagedItem;
}) {
  return (
    <td className={td}>
      {item.mappingId === null ? null : (
        <TriageControl
          {...scope}
          canManage={canManage}
          target={{
            mappingId: item.mappingId,
            version: item.version,
            cveId: item.cveId,
          }}
          triage={item.triage}
        />
      )}
    </td>
  );
}

function GroupTable({ children }: { children: ReactNode }) {
  return (
    <table className="w-full min-w-[920px] table-fixed text-sm">
      <Cols />
      <thead className="sr-only">
        <tr>
          <th scope="col">ลำดับ</th>
          <th scope="col">CVE และ component</th>
          <th scope="col">ความรุนแรง</th>
          <th scope="col">เหตุผลของลำดับ</th>
          <th scope="col">สถานะ VEX</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Group({
  testId,
  title,
  note,
  children,
}: {
  testId: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <details
      className="rounded-md border border-foreground/10 bg-surface"
      data-testid={testId}
    >
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
        {title}
      </summary>
      {note === undefined ? null : (
        <p className="px-4 pb-2 text-xs text-foreground-secondary">{note}</p>
      )}
      <div className="overflow-x-auto border-t border-foreground/10">
        <GroupTable>{children}</GroupTable>
      </div>
    </details>
  );
}

function GroupRow({
  item,
  preferences,
  testId,
}: {
  item: NewCveItem;
  preferences: Preferences;
  testId: string;
}) {
  return (
    <tr
      data-testid={testId}
      className="border-t border-foreground/10 first:border-t-0"
    >
      <td className={td} />
      <CveCell
        {...item}
        system={null}
        firstSeen={item.firstSeenAt}
        preferences={preferences}
      />
      <td className={td}>
        <SeverityPill score={null} level={item.cvssSeverity} />
      </td>
      <td className={cn(td, "text-[13px]")}>
        {item.kev === null ? (
          <span className="text-foreground-secondary">KEV ไม่ทราบ</span>
        ) : item.kev ? (
          "อยู่ใน KEV"
        ) : (
          "ไม่อยู่ใน KEV"
        )}
      </td>
      <td className={td} />
    </tr>
  );
}

const th = "px-2 py-2 text-left font-normal";

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
  const noMatchShown =
    list.summary.components !== 0 &&
    list.results !== null &&
    !(!active && view.empty) &&
    noMatch;
  const clearFilters = () => {
    onFilters(NO_FILTERS);
  };

  return (
    <div className="space-y-4">
      <HairlineGrid
        className="sm:grid-cols-2 lg:grid-cols-4"
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
      </HairlineGrid>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs text-foreground-secondary">ตัวกรอง</span>
        <label className="sr-only" htmlFor="vuln-filter-system">
          System
        </label>
        <Select
          size="sm"
          id="vuln-filter-system"
          data-testid="vuln-filter-system"
          value={filters.system ?? ""}
          onChange={(event) => {
            onFilters({ ...filters, system: event.target.value || null });
          }}
          className="w-auto"
        >
          <option value="">ทุก System</option>
          {systems.map(([id, name]) => (
            <option key={id} value={id}>
              {name === "" ? "(ไม่ระบุชื่อ System)" : name}
            </option>
          ))}
        </Select>
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
        {active && !noMatchShown ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="vuln-filter-clear"
            onClick={clearFilters}
          >
            ล้างตัวกรอง
          </Button>
        ) : null}
        {uncovered === 0 ? null : (
          <p
            className="flex flex-wrap items-center gap-x-2 text-[13px] lg:ml-auto"
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
      </div>
      {active && list.summary.components !== 0 && list.results !== null ? (
        <p
          className="text-xs text-foreground-secondary"
          data-testid="vuln-shown"
        >
          แสดง <span className="font-mono">{view.ranked.length}</span> จาก{" "}
          <span className="font-mono">{view.tiles.fix}</span> รายการที่ต้องแก้
        </p>
      ) : null}
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
        <EmptyState
          data-testid="vuln-no-inventory"
          title="ยังไม่มี component ใน inventory"
          action={
            list.canManage ? (
              <Link
                className="text-sm text-primary underline-offset-4 hover:underline"
                to={`${inventoryPath}/import`}
              >
                import inventory
              </Link>
            ) : undefined
          }
        />
      ) : list.results === null ? (
        <EmptyState
          data-testid="vuln-none"
          title="รายการที่ต้องแก้จะแสดงที่นี่หลังการตรวจครั้งแรก"
        />
      ) : !active && view.empty ? (
        <EmptyState
          data-testid="vuln-none"
          title="ไม่มี CVE ที่ยังพบ ณ การตรวจล่าสุด ไม่ได้หมายความว่าปลอดภัย"
        />
      ) : noMatch ? (
        <EmptyState
          data-testid="vuln-no-match"
          title="ไม่มีรายการตามตัวกรอง"
          action={
            <div className="flex flex-col items-center gap-3">
              <Button
                type="button"
                variant="outline"
                data-testid="vuln-filter-clear"
                onClick={clearFilters}
              >
                ล้างตัวกรอง
              </Button>
              {filters.isNew && !warned ? (
                <p
                  className="text-sm text-foreground-secondary"
                  data-testid="vuln-new-none"
                >
                  ไม่พบ CVE ใหม่ใน {fresh.windowDays} วันที่ผ่านมา ณ
                  การตรวจล่าสุด ไม่ได้หมายความว่าปลอดภัย
                </p>
              ) : null}
            </div>
          }
        />
      ) : null}
      {view.ranked.length === 0 ? null : (
        <div className="overflow-x-auto rounded-md border border-foreground/10 bg-surface">
          <table
            className="w-full min-w-[920px] table-fixed text-sm"
            data-testid="vuln-ranked"
          >
            <Cols />
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
                  <td className={cn(td, "font-mono")}>{item.rank}</td>
                  <CveCell
                    {...item}
                    firstSeen={view.firstSeen.get(itemKey(item))}
                    preferences={preferences}
                  />
                  <td className={td}>
                    <SeverityPill
                      score={item.cvssScore}
                      level={item.cvssSeverity}
                    />
                  </td>
                  <td
                    className={td}
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
                  <Vex scope={scope} canManage={list.canManage} item={item} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.notAffected.length === 0 ? null : (
        <Group
          testId="vuln-not-affected"
          title={`ไม่ได้รับผลกระทบ (VEX) ${String(view.notAffected.length)} รายการ อยู่นอกลำดับ`}
        >
          {view.notAffected.map((item) => (
            <tr
              key={`${item.cveId}|${item.systemId}|${item.vendor}|${item.product}|${item.version}`}
              data-testid={`vuln-not-affected-${item.cveId}`}
              className="border-t border-foreground/10 first:border-t-0"
            >
              <td className={td} />
              <CveCell
                {...item}
                firstSeen={view.firstSeen.get(itemKey(item))}
                preferences={preferences}
              />
              <td className={td}>
                <SeverityPill
                  score={item.cvssScore}
                  level={item.cvssSeverity}
                />
              </td>
              <td className={cn(td, "text-[13px]")}>
                {item.kev === true ? "อยู่ใน KEV" : null}
              </td>
              <Vex scope={scope} canManage={list.canManage} item={item} />
            </tr>
          ))}
        </Group>
      )}
      {view.gone.length === 0 ? null : (
        <Group
          testId="vuln-new-gone"
          title={`ใหม่แต่ไม่พบแล้ว ${String(view.gone.length)} รายการ`}
        >
          {view.gone.map((item) => (
            <GroupRow
              key={itemKey(item)}
              item={item}
              preferences={preferences}
              testId={`vuln-new-gone-${item.cveId}`}
            />
          ))}
        </Group>
      )}
      {view.unknown.length === 0 ? null : (
        <Group
          testId="vuln-new-unknown"
          title={`ใหม่แต่ยังไม่ทราบสถานะ ${String(view.unknown.length)} รายการ`}
          note="รอบล่าสุดไม่มีผลตรวจ product ของรายการเหล่านี้"
        >
          {view.unknown.map((item) => (
            <GroupRow
              key={itemKey(item)}
              item={item}
              preferences={preferences}
              testId={`vuln-new-unknown-${item.cveId}`}
            />
          ))}
        </Group>
      )}
    </div>
  );
}
