import {
  INVENTORY_LAYERS,
  inventoryIssueMessage,
  type InventoryRowItem,
  type InventorySummary,
} from "@nightwatch/api-contract";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  SearchIcon,
  TrashIcon,
} from "../../components/shell/icons";
import { PageState } from "../../components/shell/PageState";
import { Alert, Input, textInputClass } from "../../components/ui";
import { cn } from "@/lib/utils";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/ui/data-table";
import { IconButton, InfoTip } from "../../components/ui/icon-button";
import { Notice } from "../../components/ui/notice";
import { SectionHeader } from "../../components/ui/section-header";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { StatusPill } from "../../components/ui/status-pill";
import { ApiError } from "../../lib/api/client";
import {
  deleteRow,
  fetchRows,
  inventoryErrorMessage,
  inventoryKeys,
} from "../../lib/api/inventory";
import {
  hasFilters,
  NO_FILTERS,
  readFilters,
  toQuery,
  writeFilters,
  type RowFilters,
} from "../../lib/api/inventoryRowFilters";
import { usePreferences } from "../../lib/preferences";
import { NO_SYSTEM_NAME } from "./format";
import { RowDialog } from "./RowDialog";

import { sourceLabel, sourceWho } from "./rowSource";

type Scope = { organizationId: string; projectId: string };

type Dialog =
  | { kind: "add"; opener: HTMLElement | null }
  | { kind: "edit"; row: InventoryRowItem; opener: HTMLElement | null }
  | { kind: "delete"; row: InventoryRowItem; opener: HTMLElement | null };

const STATUS_OPTIONS = [
  { value: "all", label: "ทั้งหมด" },
  { value: "rejected", label: "ไม่ผ่าน" },
  { value: "duplicate", label: "key ซ้ำ" },
] as const;

function SearchForm({
  initial,
  onSearch,
}: {
  initial: string;
  onSearch: (q: string) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <form
      role="search"
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(text.trim());
      }}
    >
      <Input
        type="search"
        data-testid="inventory-rows-search"
        aria-label="ค้นหา Vendor หรือ Product"
        placeholder="Vendor หรือ Product"
        maxLength={200}
        value={text}
        className="w-[220px]"
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <IconButton
        type="submit"
        variant="secondary"
        size="icon"
        label="ค้นหา"
        data-testid="inventory-rows-search-submit"
        icon={<SearchIcon size={16} />}
      />
    </form>
  );
}

export function InventoryRowsSection({
  summary,
  scope,
}: {
  summary: InventorySummary;
  scope: Scope;
}) {
  const { preferences } = usePreferences();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const query = toQuery(filters);
  const heading = useRef<HTMLHeadingElement>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const rows = useQuery({
    queryKey: inventoryKeys.rows(scope.organizationId, scope.projectId, query),
    queryFn: ({ signal }) =>
      fetchRows(scope.organizationId, scope.projectId, query, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // A link from another part of the page (the quality table) asks for the table to take focus.
  const asked = (location.state as { focusRows?: boolean } | null)?.focusRows;
  useEffect(() => {
    if (asked === true) heading.current?.focus();
  }, [asked, location.key]);

  // A page past the end is answered with the last page; the address follows.
  const answeredPage = rows.isPlaceholderData ? undefined : rows.data?.page;
  useEffect(() => {
    const current = readFilters(params);
    if (answeredPage !== undefined && answeredPage !== current.page) {
      setParams(writeFilters({ ...current, page: answeredPage }), {
        replace: true,
      });
    }
  }, [answeredPage, params, setParams]);

  const go = (patch: Partial<RowFilters>) => {
    setParams(writeFilters({ ...filters, page: 1, ...patch }));
  };
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: inventoryKeys.all(scope.organizationId, scope.projectId),
    });

  const remove = useMutation({
    mutationFn: (row: InventoryRowItem) =>
      deleteRow(scope.organizationId, scope.projectId, row.id, row.revision),
    onSuccess: async () => {
      setDialog(null);
      setNotice("ลบแถวแล้ว");
      await refresh();
    },
    onError: async (error) => {
      // The old revision can never succeed: close the dialog, show why, reload the table.
      if (error instanceof ApiError && error.code === "INVENTORY_ROW_STALE") {
        setDialog(null);
        setFailure(error.message);
        await refresh();
      }
    },
  });

  const canEdit = summary.canUpload;
  // A System with no name takes no new row until it is renamed; its rows stay listed.
  const addable = summary.systems.filter((system) => system.name !== "");
  const systemName = (name: string) => (name === "" ? NO_SYSTEM_NAME : name);

  const columns: DataTableColumn<InventoryRowItem>[] = [
    {
      key: "system",
      header: "System",
      cell: (row) => (
        <Link
          className="font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline"
          to={`/organizations/${scope.organizationId}/projects/${scope.projectId}/inventory/systems/${row.systemId}`}
        >
          {systemName(row.systemName)}
        </Link>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      cell: (row) => (
        <span className="inline-block max-w-[120px] min-w-[80px]">
          {row.owner}
        </span>
      ),
    },
    ...(
      [
        ["vendor", "Vendor"],
        ["product", "Product"],
        ["version", "Version"],
        ["layer", "Layer"],
        ["environment", "Environment"],
        ["exposure", "Exposure"],
      ] as const
    ).map(([key, header]): DataTableColumn<InventoryRowItem> => ({
      key,
      header,
      mono: key === "version",
      cell: (row) => <span className="whitespace-nowrap">{row[key]}</span>,
    })),
    {
      key: "status",
      header: "สถานะ",
      cell: (row) => (
        <div className="flex w-[150px] flex-col items-start gap-1 py-2">
          <span className="flex flex-wrap gap-1">
            <StatusPill
              dot
              neutralLabel={row.usable}
              tone={row.usable ? "neutral" : "caution"}
            >
              {row.usable ? "ใช้งานได้" : "ไม่ผ่าน"}
            </StatusPill>
            {row.duplicate ? (
              <StatusPill tone="muted">key ซ้ำ</StatusPill>
            ) : null}
          </span>
          {row.issues.length === 0 ? null : (
            <ul className="space-y-0.5 text-xs text-foreground-secondary">
              {row.issues.map((issue) => (
                <li key={`${issue.column}:${issue.code}`}>
                  <span className="font-mono">{issue.column}</span>{" "}
                  {inventoryIssueMessage(issue)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
    {
      key: "source",
      header: "ที่มา",
      cell: (row) => (
        <div
          data-testid={`inventory-row-source-${row.id}`}
          className="flex w-[170px] flex-col py-2 text-xs"
        >
          <span className="break-words">{sourceLabel(row.source)}</span>
          <span className="font-mono break-words text-foreground-secondary">
            {sourceWho(row.source, preferences)}
          </span>
        </div>
      ),
    },
  ];

  const data = rows.data;
  const filtered = hasFilters(filters);
  const pages =
    data === undefined ? 1 : Math.max(1, Math.ceil(data.total / data.pageSize));
  const from =
    data === undefined || data.total === 0
      ? 0
      : (data.page - 1) * data.pageSize + 1;
  const to =
    data === undefined ? 0 : Math.min(data.total, data.page * data.pageSize);

  return (
    <section
      aria-labelledby="inventory-rows-heading"
      className="space-y-3"
      data-testid="inventory-rows"
    >
      <SectionHeader
        id="inventory-rows-heading"
        headingRef={heading}
        headingTabIndex={-1}
        headingTestId="inventory-rows-heading"
        title="แถวทั้งหมด"
        meta={
          <span aria-live="polite" data-testid="inventory-rows-summary">
            {data === undefined ? null : (
              <>
                <span className="font-mono">{data.total}</span> แถว
              </>
            )}
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          data-testid="inventory-rows-system"
          aria-label="System"
          className={cn(textInputClass, "w-auto")}
          value={filters.system}
          onChange={(event) => {
            go({ system: event.target.value });
          }}
        >
          <option value="">ทุก System</option>
          {summary.systems.map((system) => (
            <option key={system.id} value={system.id}>
              {systemName(system.name)}
            </option>
          ))}
        </select>
        <select
          data-testid="inventory-rows-layer"
          aria-label="Layer"
          className={cn(textInputClass, "w-auto")}
          value={filters.layer}
          onChange={(event) => {
            const layer = INVENTORY_LAYERS.find(
              (item) => item === event.target.value,
            );
            go({ layer: layer ?? "" });
          }}
        >
          <option value="">ทุก Layer</option>
          {INVENTORY_LAYERS.map((layer) => (
            <option key={layer} value={layer}>
              {layer}
            </option>
          ))}
        </select>
        <SegmentedControl
          testId="inventory-rows-status"
          label="สถานะ"
          value={filters.status}
          options={STATUS_OPTIONS}
          optionTestId={(value) => `inventory-rows-status-${value}`}
          onChange={(status) => {
            go({ status });
          }}
        />
        <InfoTip
          data-testid="inventory-rows-key-info"
          label="key ของแถวคือ System + Vendor + Product + Version ไม่สนตัวพิมพ์เล็กใหญ่และช่องว่างหัวท้าย แถวที่ key ซ้ำมาจากไฟล์ก่อนระบบห้ามซ้ำ ยังคงอยู่ครบ แก้หรือลบได้"
        />
        <SearchForm
          key={filters.q}
          initial={filters.q}
          onSearch={(q) => {
            go({ q });
          }}
        />
        {canEdit && addable.length > 0 ? (
          <Button
            type="button"
            className="ml-auto"
            data-testid="inventory-row-add"
            onClick={(event) => {
              setNotice(null);
              setFailure(null);
              setDialog({ kind: "add", opener: event.currentTarget });
            }}
          >
            เพิ่มแถว
          </Button>
        ) : null}
      </div>
      <div aria-live="polite" className="space-y-2">
        {failure === null ? null : (
          <Alert tone="error" data-testid="inventory-rows-error">
            {failure}
          </Alert>
        )}
        {notice === null ? null : (
          <Notice tone="success" data-testid="inventory-rows-success">
            {notice}
          </Notice>
        )}
      </div>
      {rows.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลดแถว"
          layout="table"
          visibleLabel
        />
      ) : rows.isError ? (
        <PageState
          kind="error"
          message={inventoryErrorMessage(rows.error)}
          retryLabel="ลองใหม่"
          onRetry={() => void rows.refetch()}
        />
      ) : data === undefined ? null : data.total === 0 ? (
        filtered ? (
          <div
            data-testid="inventory-rows-no-match"
            className="flex flex-col items-center gap-3 rounded-md border border-foreground/10 bg-surface p-8 text-center"
          >
            <p className="text-sm text-foreground-secondary">
              ไม่มีแถวตามตัวกรอง
            </p>
            <Button
              type="button"
              variant="outline"
              data-testid="inventory-rows-clear"
              onClick={() => {
                setParams(writeFilters(NO_FILTERS));
              }}
            >
              ล้างตัวกรอง
            </Button>
          </div>
        ) : (
          <p
            data-testid="inventory-rows-empty"
            className="rounded-md border border-foreground/10 bg-surface p-8 text-center text-sm text-foreground-secondary"
          >
            ยังไม่มีแถวใน inventory
          </p>
        )
      ) : (
        <>
          <DataTable
            ariaLabel="แถวทั้งหมดของ inventory"
            dense
            tableTestId="inventory-rows-table"
            columns={columns}
            rows={data.rows}
            rowKey={(row) => row.id}
            rowTestId={(row) => `inventory-row-${row.id}`}
            rowActions={
              canEdit
                ? (row) => (
                    <span className="inline-flex gap-1">
                      <IconButton
                        label={`แก้แถว ${row.product} ${row.version}`}
                        data-testid={`inventory-row-edit-${row.id}`}
                        icon={<PencilIcon />}
                        onClick={(event) => {
                          setNotice(null);
                          setFailure(null);
                          setDialog({
                            kind: "edit",
                            row,
                            opener: event.currentTarget,
                          });
                        }}
                      />
                      <IconButton
                        label={`ลบแถว ${row.product} ${row.version}`}
                        data-testid={`inventory-row-delete-${row.id}`}
                        icon={<TrashIcon />}
                        onClick={(event) => {
                          setNotice(null);
                          setFailure(null);
                          remove.reset();
                          setDialog({
                            kind: "delete",
                            row,
                            opener: event.currentTarget,
                          });
                        }}
                      />
                    </span>
                  )
                : undefined
            }
          />
          <nav
            aria-label="เปลี่ยนหน้าแถว"
            className="flex flex-wrap items-center justify-between gap-4"
          >
            <p
              data-testid="inventory-rows-page"
              className="text-xs text-foreground-secondary tabular-nums"
            >
              <span className="font-mono">
                {from}-{to}
              </span>{" "}
              จาก <span className="font-mono">{data.total}</span> · หน้า{" "}
              <span className="font-mono">{data.page}</span>/
              <span className="font-mono">{pages}</span>
            </p>
            <div className="flex gap-2">
              <IconButton
                variant="secondary"
                label="หน้าก่อนหน้า"
                data-testid="inventory-rows-previous"
                icon={<ChevronLeftIcon />}
                disabled={data.page <= 1}
                onClick={() => {
                  go({ page: data.page - 1 });
                }}
              />
              <IconButton
                variant="secondary"
                label="หน้าถัดไป"
                data-testid="inventory-rows-next"
                icon={<ChevronRightIcon />}
                disabled={data.page >= pages}
                onClick={() => {
                  go({ page: data.page + 1 });
                }}
              />
            </div>
          </nav>
        </>
      )}
      {dialog?.kind === "add" || dialog?.kind === "edit" ? (
        <RowDialog
          mode={
            dialog.kind === "add"
              ? { kind: "add", systems: addable }
              : { kind: "edit", row: dialog.row }
          }
          scope={scope}
          opener={dialog.opener}
          fallbackFocus={heading}
          onCancel={() => {
            setDialog(null);
          }}
          onSaved={(message) => {
            setDialog(null);
            setNotice(message);
            void refresh();
          }}
          onStale={() => {
            void refresh();
          }}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          data-testid="inventory-row-delete-dialog"
          confirmTestId="inventory-row-delete-confirm"
          title="ลบแถว"
          description={
            <>
              <p>
                ลบ{" "}
                <span className="font-medium text-foreground">
                  {dialog.row.product} {dialog.row.version}
                </span>{" "}
                ออกจาก {systemName(dialog.row.systemName)} ผล CVE ของ component
                นี้จะหายในรอบตรวจถัดไป
              </p>
              {remove.isError ? (
                <div className="mt-3">
                  <Alert tone="error" data-testid="inventory-row-delete-error">
                    {inventoryErrorMessage(remove.error)}
                  </Alert>
                </div>
              ) : null}
            </>
          }
          confirmLabel="ลบแถว"
          confirmVariant="destructive"
          pendingLabel="กำลังลบ…"
          pending={remove.isPending}
          opener={dialog.opener}
          fallbackFocus={heading}
          onCancel={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            remove.mutate(dialog.row);
          }}
        />
      ) : null}
    </section>
  );
}
