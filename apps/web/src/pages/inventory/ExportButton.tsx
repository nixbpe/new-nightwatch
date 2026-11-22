import { useMutation } from "@tanstack/react-query";

import { DownloadIcon } from "../../components/shell/icons";
import { Alert } from "../../components/ui";
import { IconButton } from "../../components/ui/icon-button";
import {
  downloadInventory,
  inventoryErrorMessage,
} from "../../lib/api/inventory";
import { saveBlob } from "./format";

const LABEL = "Export Excel";

/** Downloads the Project's inventory, or one System's, as the template workbook (S7.4). */
export function useInventoryExport(
  organizationId: string,
  projectId: string,
  systemId?: string,
) {
  return useMutation({
    mutationFn: () => downloadInventory(organizationId, projectId, systemId),
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename ?? "inventory.xlsx");
    },
  });
}

type Exporter = ReturnType<typeof useInventoryExport>;

export function ExportButton({
  exporter,
  testId,
}: {
  exporter: Exporter;
  testId: string;
}) {
  return (
    <IconButton
      label={LABEL}
      variant="secondary"
      size="icon"
      data-testid={testId}
      icon={<DownloadIcon />}
      disabled={exporter.isPending}
      aria-busy={exporter.isPending}
      onClick={() => {
        exporter.mutate();
      }}
    />
  );
}

/** What the page announces about the download: the wait while it is built, and why it failed. */
export function ExportStatus({
  exporter,
  testId,
}: {
  exporter: Exporter;
  testId: string;
}) {
  if (exporter.isPending) {
    return <span className="sr-only">กำลังสร้างไฟล์ Excel</span>;
  }
  return exporter.isError ? (
    <Alert tone="error" data-testid={testId}>
      {inventoryErrorMessage(exporter.error)}
    </Alert>
  ) : null;
}
