import {
  inventoryIssueMessage,
  type InventoryRejectedRow,
} from "@nightwatch/api-contract";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { useCurrentProject } from "../../components/shell/useCurrentProject";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/ui/data-table";
import {
  downloadRejectedRows,
  fetchRejectedRows,
  inventoryErrorMessage,
  inventoryKeys,
} from "../../lib/api/inventory";
import { usePreferences } from "../../lib/preferences";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import {
  formatUploadedAt,
  NO_SYSTEM_NAME,
  QUALITY_THRESHOLD,
  saveBlob,
  usablePercent,
} from "./format";

type Scope = { organizationId: string; projectId: string; systemId: string };

export function RejectedRowsPage() {
  const { organizationId, projectId, systemId } = useParams();
  if (!organizationId || !projectId || !systemId) return null;
  const scope = {
    organizationId: organizationId.toLowerCase(),
    projectId: projectId.toLowerCase(),
    systemId: systemId.toLowerCase(),
  };
  return (
    <RejectedRows
      key={`${scope.organizationId}:${scope.projectId}:${scope.systemId}`}
      {...scope}
    />
  );
}

const COLUMNS: DataTableColumn<InventoryRejectedRow>[] = [
  {
    key: "line",
    header: "แถวในไฟล์",
    mono: true,
    cell: (row) => (
      <span className="text-foreground-secondary">{row.line}</span>
    ),
  },
  { key: "owner", header: "Owner", cell: (row) => row.owner },
  { key: "product", header: "Product", cell: (row) => row.product },
  {
    key: "version",
    header: "Version",
    mono: true,
    cell: (row) => row.version,
  },
  {
    key: "issues",
    header: "เหตุผลรายคอลัมน์",
    cell: (row) => (
      <ul className="space-y-1 py-2">
        {row.issues.map((issue) => (
          <li
            key={`${issue.column}:${issue.code}`}
            data-testid={`inventory-issue-${String(row.line)}-${issue.column}`}
            className="flex items-baseline gap-2 text-[13px]"
          >
            <span className="min-w-[88px] font-mono text-xs text-danger">
              {issue.column}
            </span>
            <span>{inventoryIssueMessage(issue)}</span>
          </li>
        ))}
      </ul>
    ),
  },
];

function RejectedRows({ organizationId, projectId, systemId }: Scope) {
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const { preferences } = usePreferences();
  const { project } = useCurrentProject();
  const query = useQuery({
    queryKey: inventoryKeys.rejected(organizationId, projectId, systemId),
    queryFn: ({ signal }) =>
      fetchRejectedRows(organizationId, projectId, systemId, signal),
    enabled: !switched,
    retry: false,
  });
  const download = useMutation({
    mutationFn: () => downloadRejectedRows(organizationId, projectId, systemId),
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename ?? "rejected-rows.xlsx");
    },
  });
  if (switched) return null;
  const data = query.data;
  const back = `/organizations/${organizationId}/projects/${projectId}/inventory`;
  const name =
    data === undefined
      ? "System"
      : data.system.name === ""
        ? NO_SYSTEM_NAME
        : data.system.name;
  return (
    <Page>
      <PageHeader
        eyebrow="// inventory"
        scope={
          project === null
            ? undefined
            : { mark: project.name, label: project.name, tag: "โปรเจกต์" }
        }
        title={`แถวที่ไม่ผ่านของ ${name}`}
        status={
          data === undefined ? undefined : (
            <span data-testid="inventory-rejected-status">
              ใช้งานได้{" "}
              <span className="font-mono">{data.system.usableRows}</span> จาก{" "}
              <span className="font-mono">{data.system.totalRows}</span> แถว (
              <span className="font-mono">
                {usablePercent(data.system.usableRows, data.system.totalRows)}%
              </span>
              {data.system.lowQuality
                ? `, ต่ำกว่า ${String(QUALITY_THRESHOLD)}%`
                : ""}
              ) · จาก upload{" "}
              <span className="font-mono">
                {formatUploadedAt(data.system.uploadedAt, preferences)}
              </span>
            </span>
          )
        }
        description="แถวที่ผ่านพร้อมสำหรับการจับคู่ CVE แถวด้านล่างจะไม่ถูกนำไป match จนกว่าจะแก้ ส่งไฟล์ Excel ให้ Owner แก้ แล้วผู้ดูแล Project upload ฉบับแก้ทั้ง System ระบบไม่ส่งข้อมูลถึง Owner โดยตรง"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link data-testid="inventory-back-link" to={back}>
                กลับไป Inventory
              </Link>
            </Button>
            {data === undefined || data.rows.length === 0 ? null : (
              <Button
                data-testid="inventory-download-button"
                disabled={download.isPending}
                onClick={() => {
                  download.mutate();
                }}
              >
                {download.isPending
                  ? "กำลังสร้างไฟล์…"
                  : "ดาวน์โหลด Excel แยกตาม Owner"}
              </Button>
            )}
          </>
        }
      />
      {download.isError ? (
        <Alert tone="error" data-testid="inventory-download-error">
          {inventoryErrorMessage(download.error)}
        </Alert>
      ) : null}
      {query.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลดแถวที่ไม่ผ่าน"
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
        <DataTable
          ariaLabel="แถวที่ไม่ผ่าน"
          columns={COLUMNS}
          rows={query.data.rows}
          rowKey={(row) => String(row.line)}
          rowTestId={(row) => `inventory-rejected-row-${String(row.line)}`}
          empty="ไม่มีแถวที่ไม่ผ่าน"
        />
      )}
    </Page>
  );
}
