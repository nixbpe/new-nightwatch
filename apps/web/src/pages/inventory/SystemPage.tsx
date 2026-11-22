import {
  inventoryIssueMessage,
  type InventorySystem,
} from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type SyntheticEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { useCurrentProject } from "../../components/shell/useCurrentProject";
import { Alert, Field, Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Notice } from "../../components/ui/notice";
import { SectionHeader } from "../../components/ui/section-header";
import { StatusPill } from "../../components/ui/status-pill";
import { ApiError } from "../../lib/api/client";
import {
  deleteSystem,
  downloadRejectedRows,
  fetchInventory,
  inventoryErrorMessage,
  inventoryKeys,
  inventoryRowIssues,
  renameSystem,
} from "../../lib/api/inventory";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import {
  NO_SYSTEM_NAME,
  QUALITY_THRESHOLD,
  saveBlob,
  usablePercent,
} from "./format";

type Scope = { organizationId: string; projectId: string; systemId: string };

export function SystemPage() {
  const { organizationId, projectId, systemId } = useParams();
  if (!organizationId || !projectId || !systemId) return null;
  const scope = {
    organizationId: organizationId.toLowerCase(),
    projectId: projectId.toLowerCase(),
    systemId: systemId.toLowerCase(),
  };
  return (
    <ProjectSystem
      key={`${scope.organizationId}:${scope.projectId}:${scope.systemId}`}
      {...scope}
    />
  );
}

function RenameForm({
  system,
  scope,
  onRenamed,
  onStale,
}: {
  system: InventorySystem;
  scope: Scope;
  onRenamed: () => void;
  onStale: (message: string) => void;
}) {
  const [name, setName] = useState(system.name);
  const [error, setError] = useState<string | null>(null);
  const rename = useMutation({
    mutationFn: () =>
      renameSystem(scope.organizationId, scope.projectId, system.id, {
        name,
        revision: system.revision,
      }),
    onMutate: () => {
      setError(null);
    },
    onSuccess: (renamed) => {
      setName(renamed.name);
      onRenamed();
    },
    onError: (failure) => {
      const issue = inventoryRowIssues(failure)[0];
      if (issue !== undefined) setError(inventoryIssueMessage(issue));
      else if (
        failure instanceof ApiError &&
        failure.code === "INVENTORY_SYSTEM_NAME_TAKEN"
      ) {
        setError(failure.message);
      } else if (
        failure instanceof ApiError &&
        failure.code === "INVENTORY_SYSTEM_STALE"
      ) {
        onStale(failure.message);
      } else {
        onStale(inventoryErrorMessage(failure));
      }
    },
  });
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!rename.isPending) rename.mutate();
  };
  return (
    <section
      aria-labelledby="inventory-system-rename-heading"
      className="space-y-3"
    >
      <SectionHeader
        id="inventory-system-rename-heading"
        title="เปลี่ยนชื่อ System"
      />
      <form
        noValidate
        onSubmit={submit}
        className="flex max-w-[640px] flex-wrap items-start gap-2"
      >
        <Field
          label="ชื่อ System"
          error={error}
          errorId="inventory-system-name-error"
          errorTestId="inventory-system-name-error"
          className="min-w-[240px] flex-1"
        >
          <Input
            data-testid="inventory-system-name"
            value={name}
            aria-invalid={error === null ? undefined : true}
            aria-describedby={
              error === null ? undefined : "inventory-system-name-error"
            }
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          className="mt-6"
          data-testid="inventory-system-rename"
          disabled={rename.isPending}
        >
          {rename.isPending ? "กำลังบันทึก…" : "บันทึกชื่อ"}
        </Button>
      </form>
    </section>
  );
}

function ProjectSystem(scope: Scope) {
  const { organizationId, projectId, systemId } = scope;
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const { project } = useCurrentProject();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const title = useRef<HTMLHeadingElement>(null);
  const [confirming, setConfirming] = useState<HTMLElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const query = useQuery({
    queryKey: inventoryKeys.summary(organizationId, projectId),
    queryFn: ({ signal }) => fetchInventory(organizationId, projectId, signal),
    enabled: !switched,
    retry: false,
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: inventoryKeys.all(organizationId, projectId),
    });
  const download = useMutation({
    mutationFn: () => downloadRejectedRows(organizationId, projectId, systemId),
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename ?? "rejected-rows.xlsx");
    },
  });
  const system = query.data?.systems.find((item) => item.id === systemId);
  const remove = useMutation({
    mutationFn: (target: InventorySystem) =>
      deleteSystem(organizationId, projectId, target),
    onSuccess: (_, target) => {
      void refresh();
      void navigate(
        `/organizations/${organizationId}/projects/${projectId}/inventory`,
        {
          state: {
            notice: `ลบ System ${target.name === "" ? NO_SYSTEM_NAME : target.name} และ ${String(target.totalRows)} แถวแล้ว`,
          },
        },
      );
    },
    onError: async (error) => {
      // The revision or the row count the dialog named can never succeed again.
      if (
        error instanceof ApiError &&
        error.code === "INVENTORY_SYSTEM_STALE"
      ) {
        setConfirming(null);
        setFailure(error.message);
        await refresh();
      }
    },
  });
  if (switched) return null;

  const base = `/organizations/${organizationId}/projects/${projectId}/inventory`;
  const canEdit = query.data?.canUpload === true;
  const name =
    system === undefined
      ? "System"
      : system.name === ""
        ? NO_SYSTEM_NAME
        : system.name;
  const empty = system !== undefined && system.totalRows === 0;

  return (
    <Page>
      <PageHeader
        eyebrow="// inventory"
        scope={
          project === null
            ? undefined
            : { mark: project.name, label: project.name, tag: "โปรเจกต์" }
        }
        title={name}
        titleRef={title}
        titleTabIndex={-1}
        status={
          system === undefined ? undefined : (
            <>
              <span data-testid="inventory-system-owners">
                Owner{" "}
                <span className="font-mono">
                  {system.owners.length === 0 ? "—" : system.owners.join(", ")}
                </span>
              </span>
              <span data-testid="inventory-system-rows">
                <span className="font-mono">{system.totalRows}</span> แถว
              </span>
              <span data-testid="inventory-system-usable">
                ใช้งานได้{" "}
                <span className="font-mono">
                  {empty
                    ? "—"
                    : `${String(system.usableRows)} · ${String(usablePercent(system.usableRows, system.totalRows))}%`}
                </span>
              </span>
              <StatusPill
                data-testid="inventory-system-quality"
                dot
                neutralLabel={empty || !system.lowQuality}
                tone={
                  empty ? "muted" : system.lowQuality ? "caution" : "neutral"
                }
              >
                {empty
                  ? "ไม่มีแถว"
                  : system.lowQuality
                    ? `คุณภาพต่ำ (ต่ำกว่า ${String(QUALITY_THRESHOLD)}%)`
                    : "ผ่าน"}
              </StatusPill>
            </>
          )
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link data-testid="inventory-back-link" to={base}>
                กลับไป Inventory
              </Link>
            </Button>
            {system === undefined ? null : (
              <>
                {system.usableRows < system.totalRows ? (
                  <Button
                    variant="outline"
                    data-testid="inventory-download-button"
                    disabled={download.isPending}
                    onClick={() => {
                      download.mutate();
                    }}
                  >
                    {download.isPending
                      ? "กำลังสร้างไฟล์…"
                      : "ดาวน์โหลดแถวที่ไม่ผ่านตาม Owner"}
                  </Button>
                ) : null}
                {canEdit ? (
                  <Button
                    variant="destructive-outline"
                    data-testid="inventory-system-delete"
                    onClick={(event) => {
                      setNotice(null);
                      setFailure(null);
                      remove.reset();
                      setConfirming(event.currentTarget);
                    }}
                  >
                    ลบ System
                  </Button>
                ) : null}
                <Button asChild>
                  <Link
                    data-testid="inventory-system-rows-link"
                    to={{ pathname: base, search: `?system=${system.id}` }}
                    state={{ focusRows: true }}
                  >
                    ดูแถวของ System นี้
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />
      <div aria-live="polite" className="space-y-2 empty:hidden">
        {failure === null ? null : (
          <Alert tone="error" data-testid="inventory-system-error">
            {failure}
          </Alert>
        )}
        {download.isError ? (
          <Alert tone="error" data-testid="inventory-download-error">
            {inventoryErrorMessage(download.error)}
          </Alert>
        ) : null}
        {notice === null ? null : (
          <Notice tone="success" data-testid="inventory-system-success">
            {notice}
          </Notice>
        )}
      </div>
      {query.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลด System"
          layout="lines"
          visibleLabel
        />
      ) : query.isError ? (
        <PageState
          kind="error"
          message={inventoryErrorMessage(query.error)}
          retryLabel="ลองใหม่"
          onRetry={() => void query.refetch()}
        />
      ) : system === undefined ? (
        <PageState
          kind="error"
          data-testid="inventory-system-missing"
          message="ไม่พบ System นี้ อาจถูกลบแล้ว"
        />
      ) : canEdit ? (
        <RenameForm
          key={`${system.id}:${String(system.revision)}`}
          system={system}
          scope={scope}
          onRenamed={() => {
            setFailure(null);
            setNotice("เปลี่ยนชื่อ System แล้ว");
            void refresh();
          }}
          onStale={(message) => {
            setNotice(null);
            setFailure(message);
            void refresh();
          }}
        />
      ) : (
        <p
          data-testid="inventory-system-restricted"
          className="text-sm text-foreground-secondary"
        >
          เฉพาะผู้ดูแล Project เปลี่ยนชื่อหรือลบ System ได้
        </p>
      )}
      {confirming !== null && system !== undefined ? (
        <ConfirmDialog
          data-testid="inventory-system-delete-dialog"
          confirmTestId="inventory-system-delete-confirm"
          title="ลบ System"
          description={
            <>
              <p>
                ลบ System{" "}
                <span className="font-medium text-foreground">{name}</span>{" "}
                และแถวทั้งหมด {system.totalRows} แถวของ System นี้
              </p>
              {remove.isError ? (
                <div className="mt-3">
                  <Alert
                    tone="error"
                    data-testid="inventory-system-delete-error"
                  >
                    {inventoryErrorMessage(remove.error)}
                  </Alert>
                </div>
              ) : null}
            </>
          }
          confirmLabel={`ลบ System และ ${String(system.totalRows)} แถว`}
          confirmVariant="destructive"
          pendingLabel="กำลังลบ…"
          pending={remove.isPending}
          opener={confirming}
          fallbackFocus={title}
          onCancel={() => {
            setConfirming(null);
          }}
          onConfirm={() => {
            remove.mutate(system);
          }}
        />
      ) : null}
    </Page>
  );
}
