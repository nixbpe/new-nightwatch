import type {
  InventorySummary,
  InventorySystem,
} from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { Link, useParams } from "react-router";

import { useCurrentProject } from "../../components/shell/useCurrentProject";
import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Alert } from "../../components/ui";
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
  inventoryErrorMessage,
  inventoryKeys,
  uploadInventory,
} from "../../lib/api/inventory";
import { usePreferences } from "../../lib/preferences";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import templateUrl from "../../../../../docs/templates/inventory-template.xlsx?url";
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
    <div className="flex flex-col gap-2 px-6 py-5" data-testid={testId}>
      <span className="text-[13px] text-foreground-secondary">{label}</span>
      <span className="font-mono text-[28px] leading-8 font-medium text-heading">
        {value}
      </span>
      <span className="text-xs text-foreground-secondary">{note}</span>
    </div>
  );
}

function UploadCard({
  summary,
  scope,
}: {
  summary: InventorySummary;
  scope: Scope;
}) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (file: File) =>
      uploadInventory(scope.organizationId, scope.projectId, file),
    onMutate: () => {
      setNotice(null);
    },
    onSuccess: (next, file) => {
      queryClient.setQueryData(
        inventoryKeys.summary(scope.organizationId, scope.projectId),
        next,
      );
      setNotice(
        `นำเข้าไฟล์ ${file.name} แล้ว: ${String(next.totalRows)} แถว ใช้งานได้ ${String(next.usableRows)} แถว`,
      );
    },
  });
  const choose = (files: FileList | File[] | null) => {
    const file = files?.[0];
    if (file && !mutation.isPending) mutation.mutate(file);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files);
  };
  return (
    <section
      aria-labelledby="inventory-upload-heading"
      className="flex flex-wrap items-center gap-6 rounded-md border border-foreground/10 bg-surface p-6"
    >
      <div className="flex min-w-0 flex-1 basis-[420px] flex-col gap-2">
        <h2
          id="inventory-upload-heading"
          className="text-base font-semibold text-heading"
        >
          Upload inventory
        </h2>
        <p className="text-sm text-foreground-secondary">
          รับ <span className="font-mono text-foreground">.xlsx</span> (sheet
          ชื่อ <span className="font-mono text-foreground">Inventory</span>)
          หรือ <span className="font-mono text-foreground">.csv</span> UTF-8
          คอลัมน์ System, Owner, Vendor, Product, Version, Layer, Environment,
          Exposure
        </p>
        <p className="text-[13px] text-foreground-secondary">
          {summary.canUpload
            ? "ระบบไม่เก็บไฟล์ต้นฉบับหลังอ่านแล้ว upload ใหม่จะแทนที่ข้อมูลของ System ที่อยู่ในไฟล์"
            : "เฉพาะผู้ดูแล Project upload ได้"}
        </p>
      </div>
      <div
        data-testid="inventory-dropzone"
        onDragOver={(event) => {
          if (summary.canUpload) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={summary.canUpload ? drop : undefined}
        className={`flex min-h-[120px] min-w-0 flex-1 basis-[360px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-control-border p-5 text-center ${dragging ? "surface-active" : ""}`}
      >
        {summary.canUpload ? (
          <span className="text-sm">ลากไฟล์มาวางที่นี่ หรือ</span>
        ) : null}
        <div className="flex flex-wrap justify-center gap-2">
          {summary.canUpload ? (
            <>
              <input
                ref={input}
                data-testid="inventory-file-input"
                type="file"
                accept=".xlsx,.csv"
                aria-label="ไฟล์ inventory"
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  choose(event.target.files);
                  event.target.value = "";
                }}
              />
              <Button
                data-testid="inventory-upload-button"
                disabled={mutation.isPending}
                onClick={() => input.current?.click()}
              >
                เลือกไฟล์
              </Button>
            </>
          ) : null}
          <Button variant="outline" asChild>
            <a
              data-testid="inventory-template-link"
              href={templateUrl}
              download="inventory-template.xlsx"
            >
              ดาวน์โหลด template
            </a>
          </Button>
        </div>
      </div>
      <div className="basis-full space-y-2" aria-live="polite">
        {mutation.isPending ? (
          <Notice tone="pending" data-testid="inventory-upload-pending">
            กำลังอ่านไฟล์…
          </Notice>
        ) : null}
        {notice === null ? null : (
          <Notice tone="success" data-testid="inventory-upload-success">
            {notice}
          </Notice>
        )}
        {mutation.isError ? (
          <>
            <Alert tone="error" data-testid="inventory-upload-error">
              {inventoryErrorMessage(mutation.error)}
            </Alert>
            {summary.lastUploadAt === null ? null : (
              <p className="text-[13px] text-foreground-secondary">
                ข้อมูลเดิมยังใช้ match CVE อยู่
              </p>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

function qualityColumns(scope: Scope): DataTableColumn<InventorySystem>[] {
  return [
    {
      key: "system",
      header: "System",
      cell: (system) => (
        <span className="font-medium">
          {system.name === "" ? NO_SYSTEM_NAME : system.name}
        </span>
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
        `${String(system.usableRows)} · ${String(usablePercent(system.usableRows, system.totalRows))}%`,
    },
    {
      key: "status",
      header: "สถานะ",
      cell: (system) => (
        <StatusPill
          dot
          neutralLabel={!system.lowQuality}
          tone={system.lowQuality ? "caution" : "neutral"}
        >
          {system.lowQuality ? "คุณภาพต่ำ" : "ผ่าน"}
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
            to={`/organizations/${scope.organizationId}/projects/${scope.projectId}/inventory/systems/${system.id}`}
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
  const query = useQuery({
    queryKey: inventoryKeys.summary(organizationId, projectId),
    queryFn: ({ signal }) => fetchInventory(organizationId, projectId, signal),
    enabled: !switched,
    retry: false,
  });
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
                  upload ล่าสุด{" "}
                  <span className="font-mono">
                    {formatUploadedAt(summary.lastUploadAt, preferences)}
                  </span>{" "}
                  (<span className="font-mono">{preferences.timeZone}</span>)
                </span>
              )}
            </>
          )
        }
        description="รายการ OS, DB, middleware, runtime และ appliance ของแต่ละ System ใน Project นี้ ข้อมูลมาจากไฟล์ที่ Organization แจ้งเอง ไม่ได้มาจากการตรวจจริง"
      />
      {query.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลด inventory"
          layout="table"
          visibleLabel
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
          <UploadCard
            summary={query.data}
            scope={{ organizationId, projectId }}
          />
          <HairlineGrid className="grid-cols-1 sm:grid-cols-3">
            <Tile
              testId="inventory-tile-upload"
              label="upload ล่าสุด"
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
              label="แถวที่ใช้งานได้"
              value={String(query.data.usableRows)}
              note={`ไม่ผ่าน ${String(query.data.totalRows - query.data.usableRows)} แถว`}
            />
          </HairlineGrid>
          <section
            aria-labelledby="inventory-quality-heading"
            className="space-y-3"
          >
            <SectionHeader
              id="inventory-quality-heading"
              title="คุณภาพข้อมูลราย System"
              meta={`ผ่านเมื่อแถวที่ใช้งานได้ ≥ ${String(QUALITY_THRESHOLD)}% ของ upload ล่าสุด`}
            />
            <DataTable
              ariaLabel="คุณภาพข้อมูลราย System"
              columns={qualityColumns({ organizationId, projectId })}
              rows={query.data.systems}
              rowKey={(system) => system.id}
              rowTestId={(system) => `inventory-system-${system.id}`}
              empty="ยังไม่มี inventory ใน Project นี้ upload ไฟล์ตาม template เพื่อเริ่มต้น"
            />
          </section>
        </>
      )}
    </Page>
  );
}
