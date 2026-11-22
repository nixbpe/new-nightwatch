import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";

import { PageState } from "../../components/shell/PageState";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from "../../components/shell/icons";
import { DataTable } from "../../components/ui/data-table";
import { IconButton } from "../../components/ui/icon-button";
import { SectionHeader } from "../../components/ui/section-header";
import {
  fetchImports,
  inventoryErrorMessage,
  inventoryKeys,
} from "../../lib/api/inventory";
import { usePreferences } from "../../lib/preferences";
import { formatUploadedAt } from "./format";
import { countColumns } from "./importCounts";

// The same fallback the triage list shows for an actor whose account is gone.
const UNKNOWN_IMPORTER = "ไม่ทราบผู้ทำรายการ";

/** The confirmed imports of the Project, newest first (S7.5); metadata only. */
export function ImportHistory({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { preferences } = usePreferences();
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: inventoryKeys.imports(organizationId, projectId, page),
    queryFn: ({ signal }) =>
      fetchImports(organizationId, projectId, { page }, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const data = history.data;
  const pages =
    data === undefined ? 1 : Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <section
      aria-labelledby="inventory-import-history-heading"
      className="space-y-3"
      data-testid="inventory-import-history"
    >
      <SectionHeader
        id="inventory-import-history-heading"
        title="ประวัติ import"
      />
      {history.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลดประวัติ import"
          layout="lines"
        />
      ) : history.isError && data === undefined ? (
        <PageState
          kind="error"
          message={inventoryErrorMessage(history.error)}
          retryLabel="ลองใหม่"
          onRetry={() => void history.refetch()}
        />
      ) : data === undefined || data.total === 0 ? (
        <p
          data-testid="inventory-import-history-empty"
          className="text-sm text-foreground-secondary"
        >
          ยังไม่มีประวัติ import
        </p>
      ) : (
        <>
          <DataTable
            ariaLabel="รายการ import"
            dense
            columns={[
              {
                key: "importedAt",
                header: "เวลา",
                mono: true,
                cell: (record) => (
                  <time dateTime={record.importedAt}>
                    {formatUploadedAt(record.importedAt, preferences)}
                  </time>
                ),
              },
              {
                key: "importedBy",
                header: "ผู้ import",
                cell: (record) => record.importedBy ?? UNKNOWN_IMPORTER,
              },
              {
                key: "fileName",
                header: "ไฟล์",
                cell: (record) => (
                  <span
                    title={record.fileName}
                    className="block max-w-[28ch] truncate"
                  >
                    {record.fileName}
                  </span>
                ),
              },
              ...countColumns<(typeof data.imports)[number]>(),
            ]}
            rows={data.imports}
            rowKey={(record) => record.id}
            rowTestId={(record) => `inventory-import-record-${record.id}`}
          />
          {data.total > data.pageSize ? (
            <nav
              aria-label="เปลี่ยนหน้าประวัติ import"
              data-testid="inventory-import-history-nav"
              className="flex flex-wrap items-center justify-between gap-4"
            >
              <p
                aria-live="polite"
                data-testid="inventory-import-history-page"
                className="text-xs text-foreground-secondary tabular-nums"
              >
                <span className="font-mono">
                  {(data.page - 1) * data.pageSize + 1}-
                  {(data.page - 1) * data.pageSize + data.imports.length}
                </span>{" "}
                จาก <span className="font-mono">{data.total}</span> · หน้า{" "}
                <span className="font-mono">{data.page}</span>/
                <span className="font-mono">{pages}</span>
              </p>
              <div className="flex gap-2">
                <IconButton
                  variant="secondary"
                  label="หน้าก่อนหน้า"
                  data-testid="inventory-import-history-previous"
                  icon={<ChevronLeftIcon />}
                  disabled={data.page <= 1}
                  onClick={() => {
                    setPage(data.page - 1);
                  }}
                />
                <IconButton
                  variant="secondary"
                  label="หน้าถัดไป"
                  data-testid="inventory-import-history-next"
                  icon={<ChevronRightIcon />}
                  disabled={data.page >= pages}
                  onClick={() => {
                    setPage(data.page + 1);
                  }}
                />
              </div>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
