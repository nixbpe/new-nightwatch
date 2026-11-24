import type { InventorySystem } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";

import { useCurrentProject } from "../../components/shell/useCurrentProject";
import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Button } from "../../components/ui/button";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/ui/data-table";
import { HairlineGrid } from "../../components/ui/hairline-grid";
import { Notice } from "../../components/ui/notice";
import { SectionHeader } from "../../components/ui/section-header";
import { StatusPill } from "../../components/ui/status-pill";
import {
  fetchInventory,
  INVENTORY_DENIED_MESSAGE,
  inventoryErrorMessage,
  isInventoryAccessDenied,
  inventoryKeys,
} from "../../lib/api/inventory";
import { usePreferences } from "../../lib/preferences";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import { ExportButton, ExportStatus, useInventoryExport } from "./ExportButton";
import { InventoryRowsSection } from "./InventoryRowsSection";
import { RowDialog } from "./RowDialog";
import {
  formatUploadedAt,
  NO_SYSTEM_NAME,
  QUALITY_THRESHOLD,
  usablePercent,
} from "./format";

type Scope = { organizationId: string; projectId: string };

export function InventoryPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return null;
  const org = organizationId.toLowerCase();
  const project = projectId.toLowerCase();
  return (
    <ProjectInventory
      key={`${org}:${project}`}
      organizationId={org}
      projectId={project}
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
  value: string;
  note: React.ReactNode;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3" data-testid={testId}>
      <span className="text-[13px] text-foreground-secondary">{label}</span>
      <span className="font-mono text-xl leading-7 font-medium text-heading">
        {value}
      </span>
      <span className="text-xs text-foreground-secondary">{note}</span>
    </div>
  );
}

function qualityColumns(scope: Scope): DataTableColumn<InventorySystem>[] {
  return [
    {
      key: "system",
      header: "System",
      // Every System opens its page, which is the only way to rename or delete an empty one.
      cell: (system) => (
        <Link
          data-testid={`inventory-open-system-${system.id}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
          to={`/organizations/${scope.organizationId}/projects/${scope.projectId}/inventory/systems/${system.id}`}
        >
          {system.name === "" ? NO_SYSTEM_NAME : system.name}
        </Link>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      cell: (system) => system.owners.join(", "),
    },
    {
      key: "rows",
      header: "แถว",
      align: "end",
      mono: true,
      cell: (system) => String(system.totalRows),
    },
    {
      key: "usable",
      header: "ใช้งานได้",
      align: "end",
      mono: true,
      cell: (system) =>
        system.totalRows === 0
          ? "—"
          : `${String(system.usableRows)} · ${String(usablePercent(system.usableRows, system.totalRows))}%`,
    },
    {
      key: "status",
      header: "คุณภาพข้อมูล",
      cell: (system) => (
        <StatusPill
          data-testid={`inventory-quality-${system.id}`}
          data-low-quality={system.lowQuality}
          dot
          neutralLabel={system.totalRows === 0 || !system.lowQuality}
          tone={
            system.totalRows === 0
              ? "muted"
              : system.lowQuality
                ? "caution"
                : "neutral"
          }
        >
          {system.totalRows === 0
            ? "ไม่มีแถว"
            : system.lowQuality
              ? `คุณภาพต่ำ (ต่ำกว่า ${String(QUALITY_THRESHOLD)}%)`
              : `ผ่านเกณฑ์ ${String(QUALITY_THRESHOLD)}%`}
        </StatusPill>
      ),
    },
    {
      key: "action",
      header: <span className="sr-only">การดำเนินการ</span>,
      align: "end",
      cell: (system) =>
        system.usableRows < system.totalRows ? (
          <Link
            data-testid={`inventory-rejected-link-${system.id}`}
            className="text-[13px] text-primary underline-offset-4 hover:underline"
            to={{
              pathname: `/organizations/${scope.organizationId}/projects/${scope.projectId}/inventory`,
              search: `?system=${system.id}&status=rejected`,
            }}
            state={{ focusRows: true }}
          >
            ดูแถวที่ไม่ผ่าน
          </Link>
        ) : null,
    },
  ];
}

function ProjectInventory({ organizationId, projectId }: Scope) {
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const { preferences } = usePreferences();
  const { project } = useCurrentProject();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // The System page leaves its success message here after it deletes the System.
  const carried = (location.state as { notice?: string } | null)?.notice;
  const query = useQuery({
    queryKey: inventoryKeys.summary(organizationId, projectId),
    queryFn: ({ signal }) => fetchInventory(organizationId, projectId, signal),
    enabled: !switched,
    retry: false,
  });
  const exporter = useInventoryExport(organizationId, projectId);
  if (switched) return null;
  const summary = query.data;
  return (
    <Page>
      <PageHeader
        eyebrow="// inventory"
        scope={
          project === null
            ? undefined
            : { mark: project.name, label: project.name, tag: "โปรเจกต์" }
        }
        title="Inventory"
        status={
          summary === undefined ? undefined : (
            <>
              <span data-testid="inventory-status-systems">
                <span className="font-mono">{summary.systemCount}</span> System
              </span>
              <span data-testid="inventory-status-rows">
                <span className="font-mono">{summary.totalRows}</span> แถว
              </span>
              {summary.lastUploadAt === null ? null : (
                <span data-testid="inventory-status-uploaded">
                  import ล่าสุด{" "}
                  <span className="font-mono">
                    {formatUploadedAt(summary.lastUploadAt, preferences)}
                  </span>{" "}
                  (<span className="font-mono">{preferences.timeZone}</span>)
                </span>
              )}
            </>
          )
        }
        titleRef={heading}
        titleTabIndex={-1}
        description="รายการ OS, DB, middleware, runtime และ appliance ของแต่ละ System ใน Project นี้ ข้อมูลที่องค์กรระบุและดูแลเอง ไม่ได้มาจากการตรวจทรัพยากรจริง"
        actions={
          summary === undefined ? undefined : (
            <>
              {summary.canUpload ? (
                <>
                  <Button asChild>
                    <Link
                      data-testid="inventory-import-link"
                      to={`/organizations/${organizationId}/projects/${projectId}/inventory/import`}
                    >
                      Import
                    </Link>
                  </Button>
                  <Button
                    variant="secondary"
                    data-testid="inventory-add-system"
                    onClick={(event) => {
                      setAdded(null);
                      setAdding(event.currentTarget);
                    }}
                  >
                    เพิ่มระบบใน Inventory
                  </Button>
                </>
              ) : null}
              <ExportButton exporter={exporter} testId="inventory-export" />
            </>
          )
        }
      />
      <div aria-live="polite" className="space-y-2 empty:hidden">
        <ExportStatus exporter={exporter} testId="inventory-export-error" />
        {(added ?? carried) ? (
          <Notice tone="success" data-testid="inventory-success">
            {added ?? carried}
          </Notice>
        ) : null}
      </div>
      {query.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลด inventory"
          layout="table"
          visibleLabel
        />
      ) : isInventoryAccessDenied(query.error) ? (
        <PageState
          kind="denied"
          data-testid="inventory-denied"
          message={INVENTORY_DENIED_MESSAGE}
        />
      ) : query.isError ? (
        <PageState
          kind="error"
          message={inventoryErrorMessage(query.error)}
          retryLabel="ลองใหม่"
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <HairlineGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              testId="inventory-tile-upload"
              label="import ล่าสุด"
              value={
                query.data.lastUploadAt === null
                  ? "ยังไม่มี"
                  : formatUploadedAt(query.data.lastUploadAt, preferences)
              }
              note={query.data.lastUploadFileName ?? "—"}
            />
            <Tile
              testId="inventory-tile-total"
              label="แถวทั้งหมด"
              value={String(query.data.totalRows)}
              note={`${String(query.data.systemCount)} System`}
            />
            <Tile
              testId="inventory-tile-usable"
              label="ใช้งานได้"
              value={String(query.data.usableRows)}
              note={`ไม่ผ่าน ${String(query.data.totalRows - query.data.usableRows)} แถว`}
            />
            <Tile
              testId="inventory-tile-mappings"
              label="รอยืนยัน CPE/purl"
              value={String(query.data.mappings.pending)}
              note={
                <Link
                  data-testid="inventory-mappings-link"
                  className="text-primary underline-offset-4 hover:underline"
                  to={`/organizations/${organizationId}/projects/${projectId}/inventory/mappings`}
                >
                  ไปที่คิวยืนยัน
                </Link>
              }
            />
          </HairlineGrid>
          {query.data.systemCount === 0 ? null : (
            <InventoryRowsSection
              summary={query.data}
              scope={{ organizationId, projectId }}
            />
          )}
          <details
            className="space-y-3"
            data-testid="inventory-quality-details"
            open={query.data.systemCount === 0}
          >
            <summary className="cursor-pointer rounded-sm py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              คุณภาพข้อมูลราย System · {query.data.systemCount} System · ไม่ผ่าน{" "}
              {query.data.totalRows - query.data.usableRows} แถว
            </summary>
            <SectionHeader
              id="inventory-quality-heading"
              title="คุณภาพข้อมูลราย System"
              meta={`แถวที่ใช้งานได้ ≥ ${String(QUALITY_THRESHOLD)}% ของแถวปัจจุบัน ไม่ใช่ผลตรวจความปลอดภัย`}
            />
            <DataTable
              ariaLabel="คุณภาพข้อมูลราย System"
              columns={qualityColumns({ organizationId, projectId })}
              rows={query.data.systems}
              rowKey={(system) => system.id}
              rowTestId={(system) => `inventory-system-${system.id}`}
              empty={
                query.data.canUpload ? (
                  <>
                    ยังไม่มี inventory ใน Project นี้{" "}
                    <Link
                      data-testid="inventory-empty-import-link"
                      className="text-primary underline-offset-4 hover:underline"
                      to={`/organizations/${organizationId}/projects/${projectId}/inventory/import`}
                    >
                      ไปที่ Import
                    </Link>
                  </>
                ) : (
                  "ยังไม่มี inventory ใน Project นี้"
                )
              }
            />
          </details>
        </>
      )}
      {adding === null ? null : (
        <RowDialog
          mode={{ kind: "system" }}
          scope={{ organizationId, projectId }}
          opener={adding}
          fallbackFocus={heading}
          onCancel={() => {
            setAdding(null);
          }}
          onSaved={(message) => {
            setAdding(null);
            setAdded(message);
            void queryClient.invalidateQueries({
              queryKey: inventoryKeys.all(organizationId, projectId),
            });
          }}
          onStale={() => undefined}
        />
      )}
    </Page>
  );
}
