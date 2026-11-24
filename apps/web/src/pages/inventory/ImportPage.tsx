import {
  INVENTORY_MAX_FILE_BYTES,
  INVENTORY_MAX_ROWS,
  inventoryImportReasonMessage,
  type InventoryImportCounts,
  type InventoryImportPreview,
  type InventoryImportResult,
} from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { useCurrentProject } from "../../components/shell/useCurrentProject";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { DataTable, DataTablePagination } from "../../components/ui/data-table";
import { HairlineGrid } from "../../components/ui/hairline-grid";
import { InfoTip } from "../../components/ui/icon-button";
import { Notice } from "../../components/ui/notice";
import { SectionHeader } from "../../components/ui/section-header";
import { StatusPill } from "../../components/ui/status-pill";
import { ApiError } from "../../lib/api/client";
import {
  cancelImportPreview,
  confirmImport,
  createImportPreview,
  fetchImportPreview,
  fetchInventory,
  INVENTORY_DENIED_MESSAGE,
  inventoryErrorMessage,
  isInventoryAccessDenied,
  inventoryKeys,
} from "../../lib/api/inventory";
import { usePreferences } from "../../lib/preferences";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import templateUrl from "../../../../../docs/templates/inventory-template.xlsx?url";
import { formatUploadedAt, NO_SYSTEM_NAME } from "./format";
import { COUNT_LABELS, countColumns } from "./importCounts";
import { ImportHistory } from "./ImportHistory";

type Scope = { organizationId: string; projectId: string };

const FORMAT_HINT = `รับ .xlsx (sheet ชื่อ Inventory) หรือ .csv UTF-8 ไม่เกิน ${String(INVENTORY_MAX_FILE_BYTES / 1024 / 1024)} MB และ ${String(INVENTORY_MAX_ROWS)} แถว คอลัมน์ System, Owner, Vendor, Product, Version, Layer, Environment, Exposure ระบบไม่เก็บไฟล์ต้นฉบับ`;

export function ImportPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return null;
  const org = organizationId.toLowerCase();
  const project = projectId.toLowerCase();
  return (
    <ProjectImport
      key={`${org}:${project}`}
      organizationId={org}
      projectId={project}
    />
  );
}

const countsLine = (counts: InventoryImportCounts) =>
  COUNT_LABELS.map(([key, label]) => `${label} ${String(counts[key])}`).join(
    " · ",
  );

function CountTiles({ counts }: { counts: InventoryImportCounts }) {
  return (
    <HairlineGrid
      as="dl"
      className="grid-cols-2 sm:grid-cols-5"
      data-testid="inventory-import-totals"
    >
      {COUNT_LABELS.map(([key, label]) => (
        <div
          key={key}
          className="flex flex-col gap-1 px-4 py-3"
          data-testid={`inventory-import-total-${key}`}
        >
          <dt className="text-[13px] text-foreground-secondary">{label}</dt>
          <dd className="font-mono text-2xl font-medium text-heading">
            {counts[key]}
          </dd>
        </div>
      ))}
    </HairlineGrid>
  );
}

function Choose({
  disabled,
  onFile,
}: {
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const choose = (files: FileList | File[] | null) => {
    const file = files?.[0];
    if (file && !disabled) onFile(file);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files);
  };
  return (
    <div
      data-testid="inventory-dropzone"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={drop}
      className={`flex min-h-[120px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-control-border p-5 text-center ${dragging ? "surface-active" : ""}`}
    >
      <span className="text-sm">ลากไฟล์มาวางที่นี่ หรือ</span>
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
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          data-testid="inventory-choose-button"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          เลือกไฟล์
        </Button>
        <TemplateLink />
      </div>
    </div>
  );
}

function TemplateLink() {
  return (
    <Button variant="outline" asChild>
      <a
        data-testid="inventory-template-link"
        href={templateUrl}
        download="inventory-template.xlsx"
      >
        ดาวน์โหลด template
      </a>
    </Button>
  );
}

const SKIPPED_PAGE_SIZE = 50;

// The preview can carry up to INVENTORY_MAX_ROWS rows; the table has no scroll box of its own
// (LAY-02), so it pages instead of growing with the file.
function SkippedRowsTable({ rows }: { rows: InventoryImportPreview["rows"] }) {
  const [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(rows.length / SKIPPED_PAGE_SIZE) - 1);
  const current = Math.min(page, last);
  const from = current * SKIPPED_PAGE_SIZE;
  const shown = rows.slice(from, from + SKIPPED_PAGE_SIZE);
  return (
    <>
      <DataTable
        ariaLabel="แถวที่ข้ามและไม่ผ่าน"
        dense
        columns={[
          {
            key: "line",
            header: "แถวในไฟล์",
            align: "end",
            mono: true,
            cell: (row) => String(row.line),
          },
          {
            key: "system",
            header: "System",
            cell: (row) => (row.system === "" ? "—" : row.system),
          },
          {
            key: "product",
            header: "Product",
            cell: (row) =>
              [row.vendor, row.product, row.version]
                .filter((part) => part !== "")
                .join(" "),
          },
          {
            key: "outcome",
            header: "ผล",
            cell: (row) => (
              <StatusPill
                dot
                neutralLabel
                tone={row.outcome === "failed" ? "caution" : "muted"}
              >
                {row.outcome === "failed" ? "ไม่ผ่าน" : "ข้าม"}
              </StatusPill>
            ),
          },
          {
            key: "reason",
            header: "เหตุผล",
            cell: (row) => inventoryImportReasonMessage(row.reason),
          },
        ]}
        rows={shown}
        rowKey={(row) => String(row.line)}
        rowTestId={(row) => `inventory-import-row-${String(row.line)}`}
      />
      {rows.length <= SKIPPED_PAGE_SIZE ? null : (
        <DataTablePagination
          data-testid="inventory-import-rows-pagination"
          ariaLabel="หน้าของแถวที่ข้ามและไม่ผ่าน"
          summary={`แสดง ${String(from + 1)} ถึง ${String(from + shown.length)} จาก ${String(rows.length)} แถว`}
          previousLabel="ก่อนหน้า"
          nextLabel="ถัดไป"
          hasPrevious={current > 0}
          hasNext={current < last}
          onPrevious={() => {
            setPage(current - 1);
          }}
          onNext={() => {
            setPage(current + 1);
          }}
        />
      )}
    </>
  );
}

function PreviewView({
  preview,
  pending,
  stale,
  onConfirm,
  onCancel,
  onFile,
}: {
  preview: InventoryImportPreview;
  pending: boolean;
  stale: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onFile: (file: File) => void;
}) {
  const { preferences } = usePreferences();
  const replace = useRef<HTMLInputElement>(null);
  return (
    <>
      <section
        aria-labelledby="inventory-import-preview-heading"
        className="space-y-4"
        data-testid="inventory-import-preview"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[320px]">
            <SectionHeader
              id="inventory-import-preview-heading"
              title={`Preview ของ ${preview.fileName}`}
              meta={`หมดอายุ ${formatUploadedAt(preview.expiresAt, preferences)} (${preferences.timeZone})`}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={replace}
              data-testid="inventory-import-replace-input"
              type="file"
              accept=".xlsx,.csv"
              aria-label="เลือกไฟล์ใหม่แทน preview"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file && !pending) onFile(file);
                event.target.value = "";
              }}
            />
            <Button
              variant={stale ? "default" : "outline"}
              disabled={pending}
              data-testid="inventory-import-replace"
              onClick={() => replace.current?.click()}
            >
              เลือกไฟล์ใหม่
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              data-testid="inventory-import-cancel"
              onClick={onCancel}
            >
              ยกเลิก
            </Button>
            <Button
              disabled={pending || stale}
              data-testid="inventory-import-confirm"
              onClick={onConfirm}
            >
              {pending ? "กำลัง import…" : "ยืนยัน import"}
            </Button>
          </div>
        </div>
        {stale ? (
          <p
            data-testid="inventory-import-stale"
            className="text-[13px] text-foreground-secondary"
          >
            ตัวเลขนี้อาจล้าสมัย
          </p>
        ) : null}
        <CountTiles counts={preview.totals} />
        {preview.warnings.map((warning) => (
          <Alert
            key={`${warning.system}:${warning.vendor}:${warning.product}`}
            tone="warning"
            role="status"
            data-testid="inventory-import-warning"
          >
            {warning.system}: {warning.vendor} {warning.product} เพิ่มเวอร์ชัน{" "}
            {warning.newVersions.join(", ")} เวอร์ชันเดิม{" "}
            {warning.existingVersions.join(", ")} ยังอยู่
            และลบได้ในตารางหน้าภาพรวม
          </Alert>
        ))}
        <DataTable
          ariaLabel="ผลต่อ System"
          columns={[
            {
              key: "system",
              header: "System",
              cell: (system) => (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {system.name === "" ? NO_SYSTEM_NAME : system.name}
                  {system.created ? <StatusPill>ใหม่</StatusPill> : null}
                </span>
              ),
            },
            ...countColumns<InventoryImportPreview["systems"][number]>(),
          ]}
          rows={preview.systems}
          rowKey={(system) => system.key}
          rowTestId={(system) => `inventory-import-system-${system.key}`}
          empty="ไม่มี System ที่นำเข้าได้ในไฟล์นี้"
        />
      </section>
      {preview.rows.length === 0 ? null : (
        <section
          aria-labelledby="inventory-import-rows-heading"
          className="space-y-3"
        >
          <SectionHeader
            id="inventory-import-rows-heading"
            title="แถวที่ข้ามและไม่ผ่าน"
            meta={`${String(preview.rows.length)} แถว`}
          />
          <SkippedRowsTable rows={preview.rows} />
        </section>
      )}
    </>
  );
}

function ResultView({
  result,
  scope,
  onAnother,
}: {
  result: InventoryImportResult;
  scope: Scope;
  onAnother: () => void;
}) {
  const base = `/organizations/${scope.organizationId}/projects/${scope.projectId}/inventory`;
  return (
    <section
      aria-labelledby="inventory-import-result-heading"
      className="space-y-4"
      data-testid="inventory-import-result"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-[320px]">
          <SectionHeader
            id="inventory-import-result-heading"
            title={`ผลของ ${result.fileName}`}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onAnother}>
            import ไฟล์อื่น
          </Button>
          {result.totals.failed > 0 ? (
            <Button variant="outline" asChild>
              <Link
                data-testid="inventory-import-fix-failed"
                to={{ pathname: base, search: "?status=rejected" }}
                state={{ focusRows: true }}
              >
                ไปแก้ {result.totals.failed} แถวที่ไม่ผ่าน
              </Link>
            </Button>
          ) : null}
          <Button asChild>
            <Link data-testid="inventory-import-done" to={base}>
              ไปที่ Inventory
            </Link>
          </Button>
        </div>
      </div>
      <CountTiles counts={result.totals} />
      <DataTable
        ariaLabel="System ที่ import"
        columns={[
          {
            key: "system",
            header: "System",
            cell: (system) => {
              const changed = system.added + system.updated + system.failed > 0;
              const name = system.name === "" ? NO_SYSTEM_NAME : system.name;
              return (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {changed ? (
                    <Link
                      data-testid={`inventory-import-system-link-${system.id}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      to={`${base}/systems/${system.id}`}
                    >
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                  {system.created ? <StatusPill>ใหม่</StatusPill> : null}
                </span>
              );
            },
          },
          ...countColumns<InventoryImportResult["systems"][number]>(),
        ]}
        rows={result.systems}
        rowKey={(system) => system.id}
        rowTestId={(system) => `inventory-import-result-system-${system.id}`}
      />
    </section>
  );
}

function ProjectImport({ organizationId, projectId }: Scope) {
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const { project } = useCurrentProject();
  const queryClient = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const [result, setResult] = useState<InventoryImportResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stalePreviewId, setStalePreviewId] = useState<string | null>(null);
  const base = `/organizations/${organizationId}/projects/${projectId}/inventory`;
  const previewKey = inventoryKeys.importPreview(organizationId, projectId);

  const summary = useQuery({
    queryKey: inventoryKeys.summary(organizationId, projectId),
    queryFn: ({ signal }) => fetchInventory(organizationId, projectId, signal),
    enabled: !switched,
    retry: false,
  });
  const canImport = summary.data?.canUpload === true;
  const pending = useQuery({
    queryKey: previewKey,
    queryFn: ({ signal }) =>
      fetchImportPreview(organizationId, projectId, signal),
    enabled: !switched && canImport,
    retry: false,
  });
  const preview = pending.data?.preview ?? null;
  const setPreview = (next: InventoryImportPreview | null) => {
    queryClient.setQueryData(previewKey, { preview: next });
  };
  // The button that was pressed goes away with its step, so focus moves to the page title.
  const toTitle = () => {
    heading.current?.focus();
  };

  const choose = useMutation({
    mutationFn: (file: File) =>
      createImportPreview(organizationId, projectId, file),
    onMutate: () => {
      setFailure(null);
      setResult(null);
    },
    onSuccess: (created) => {
      setPreview(created);
      toTitle();
    },
  });
  const confirm = useMutation({
    mutationFn: (target: InventoryImportPreview) =>
      confirmImport(organizationId, projectId, target.id),
    onMutate: () => {
      setFailure(null);
    },
    onSuccess: (done) => {
      setPreview(null);
      setResult(done);
      toTitle();
      // The rows and the summary are what the import just changed.
      void queryClient.invalidateQueries({
        queryKey: inventoryKeys.all(organizationId, projectId),
      });
    },
    onError: (error, target) => {
      setFailure(inventoryErrorMessage(error));
      // A preview that expired or is gone can never be confirmed; a stale one stays to be read.
      if (
        error instanceof ApiError &&
        error.code === "INVENTORY_PREVIEW_STALE"
      ) {
        setStalePreviewId(target.id);
      }
      if (
        error instanceof ApiError &&
        (error.code === "INVENTORY_PREVIEW_EXPIRED" ||
          error.code === "INVENTORY_PREVIEW_NOT_FOUND")
      ) {
        setPreview(null);
        toTitle();
      }
    },
  });
  const cancel = useMutation({
    mutationFn: (target: InventoryImportPreview) =>
      cancelImportPreview(organizationId, projectId, target.id),
    onMutate: () => {
      setFailure(null);
    },
    onSuccess: () => {
      setPreview(null);
      toTitle();
    },
    onError: (error) => {
      setFailure(inventoryErrorMessage(error));
      void pending.refetch();
    },
  });
  if (switched) return null;
  const busy = choose.isPending || confirm.isPending || cancel.isPending;

  return (
    <Page>
      <PageHeader
        eyebrow="// inventory"
        scope={
          project === null
            ? undefined
            : { mark: project.name, label: project.name, tag: "โปรเจกต์" }
        }
        title="Import inventory"
        titleRef={heading}
        titleTabIndex={-1}
        description="ข้อมูลมาจากไฟล์ที่ Organization แจ้งเอง ไม่ได้มาจากการตรวจจริง"
        actions={
          <Button variant="outline" asChild>
            <Link data-testid="inventory-back-link" to={base}>
              กลับไป Inventory
            </Link>
          </Button>
        }
      />
      <div aria-live="polite" className="space-y-2 empty:hidden">
        {choose.isPending ? (
          <Notice tone="pending" data-testid="inventory-import-reading">
            กำลังอ่านไฟล์…
          </Notice>
        ) : null}
        {preview !== null && !choose.isPending ? (
          <Notice tone="success" data-testid="inventory-import-previewed">
            อ่านไฟล์ {preview.fileName} แล้ว {countsLine(preview.totals)}{" "}
            ยังไม่มีข้อมูลเปลี่ยนจนกว่าจะกด ยืนยัน import
          </Notice>
        ) : null}
        {result === null ? null : (
          <Notice tone="success" data-testid="inventory-import-success">
            import ไฟล์ {result.fileName} แล้ว {countsLine(result.totals)}
          </Notice>
        )}
        {choose.isError ? (
          <Alert tone="error" data-testid="inventory-import-error">
            {inventoryErrorMessage(choose.error)}
          </Alert>
        ) : null}
        {failure === null ? null : (
          <Alert tone="error" data-testid="inventory-import-failure">
            {failure}
          </Alert>
        )}
      </div>
      {summary.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลด"
          layout="lines"
          visibleLabel
        />
      ) : isInventoryAccessDenied(summary.error) ? (
        <PageState
          kind="denied"
          data-testid="inventory-import-denied"
          message={INVENTORY_DENIED_MESSAGE}
        />
      ) : summary.isError ? (
        <PageState
          kind="error"
          message={inventoryErrorMessage(summary.error)}
          retryLabel="ลองใหม่"
          onRetry={() => void summary.refetch()}
        />
      ) : !canImport ? (
        <PageState
          kind="denied"
          tone="info"
          data-testid="inventory-import-restricted"
          message="เฉพาะผู้ดูแล Project import ได้"
          action={<TemplateLink />}
        />
      ) : pending.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลด preview"
          layout="lines"
          visibleLabel
        />
      ) : pending.isError ? (
        <PageState
          kind="error"
          message={inventoryErrorMessage(pending.error)}
          retryLabel="ลองใหม่"
          onRetry={() => void pending.refetch()}
        />
      ) : result !== null ? (
        <ResultView
          result={result}
          scope={{ organizationId, projectId }}
          onAnother={() => {
            setResult(null);
            toTitle();
          }}
        />
      ) : preview !== null ? (
        <PreviewView
          key={preview.id}
          preview={preview}
          pending={busy}
          stale={stalePreviewId === preview.id}
          onConfirm={() => {
            confirm.mutate(preview);
          }}
          onCancel={() => {
            cancel.mutate(preview);
          }}
          onFile={(file) => {
            choose.mutate(file);
          }}
        />
      ) : (
        <section
          aria-labelledby="inventory-import-choose-heading"
          className="space-y-3 rounded-md border border-foreground/10 bg-surface p-6"
        >
          <div className="flex items-center gap-1">
            <h2
              id="inventory-import-choose-heading"
              className="text-base font-semibold text-heading"
            >
              เลือกไฟล์
            </h2>
            <InfoTip label={FORMAT_HINT} data-testid="inventory-format-hint" />
          </div>
          <Choose
            disabled={busy}
            onFile={(file) => {
              choose.mutate(file);
            }}
          />
        </section>
      )}
      {summary.isSuccess ? (
        <ImportHistory
          key={result?.importedAt ?? "history"}
          organizationId={organizationId}
          projectId={projectId}
        />
      ) : null}
    </Page>
  );
}
