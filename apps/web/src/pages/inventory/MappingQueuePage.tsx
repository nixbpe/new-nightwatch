import type { InventoryMapping } from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { useCurrentProject } from "../../components/shell/useCurrentProject";
import { Alert, Field, Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/ui/data-table";
import { Notice } from "../../components/ui/notice";
import { SectionHeader } from "../../components/ui/section-header";
import { SegmentedControl } from "../../components/ui/segmented-control";
import {
  decideMapping,
  fetchMappings,
  INVENTORY_DENIED_MESSAGE,
  inventoryErrorMessage,
  isInventoryAccessDenied,
  inventoryKeys,
  suggestMapping,
} from "../../lib/api/inventory";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";
import { MappingDialog } from "./MappingDialog";

type Scope = { organizationId: string; projectId: string };

export function MappingQueuePage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return null;
  const scope = {
    organizationId: organizationId.toLowerCase(),
    projectId: projectId.toLowerCase(),
  };
  return (
    <MappingQueue
      key={`${scope.organizationId}:${scope.projectId}`}
      {...scope}
    />
  );
}

const SOURCE_LABELS = {
  central: "จากตารางกลาง",
  nvd: "จาก NVD",
  manual: "กรอกเอง",
} as const;

const PROPOSAL_OPTIONS = [
  { value: "all", label: "ทั้งหมด" },
  { value: "proposed", label: "มีข้อเสนอ" },
  { value: "none", label: "ยังไม่มีข้อเสนอ" },
] as const;

type ProposalFilter = (typeof PROPOSAL_OPTIONS)[number]["value"];

function matches(item: InventoryMapping, search: string) {
  const text = search.trim().toLowerCase();
  return (
    text === "" || `${item.vendor} ${item.product}`.toLowerCase().includes(text)
  );
}

function identifier(item: InventoryMapping) {
  const value = item.cpe ?? item.purl;
  return value === null ? null : (
    <span className="font-mono text-[13px] break-all">{value}</span>
  );
}

function MappingQueue({ organizationId, projectId }: Scope) {
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const { project } = useCurrentProject();
  const queryClient = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const pendingHeading = useRef<HTMLHeadingElement>(null);
  const queue = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [proposal, setProposal] = useState<ProposalFilter>("all");
  // The row that takes focus once the buttons of the one just handled are back.
  const [focusRow, setFocusRow] = useState<{ id: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    item: InventoryMapping;
    opener: HTMLElement | null;
  } | null>(null);
  const query = useQuery({
    queryKey: inventoryKeys.mappings(organizationId, projectId),
    queryFn: ({ signal }) => fetchMappings(organizationId, projectId, signal),
    enabled: !switched,
    retry: false,
  });
  const visiblePending = (item: InventoryMapping) =>
    item.status === "pending" &&
    matches(item, search) &&
    (proposal === "all" ||
      (proposal === "proposed") === (item.cpe !== null || item.purl !== null));
  const changed = (saved: InventoryMapping, text: string) => {
    // The button that was pressed leaves with its row: focus follows to the row that
    // took its place, or to the pending heading when none is left.
    const before = queryClient.getQueryData<typeof query.data>(
      inventoryKeys.mappings(organizationId, projectId),
    )?.items;
    const was = before?.find((item) => item.id === saved.id);
    const waiting = before?.filter(visiblePending) ?? [];
    const at = waiting.findIndex((item) => item.id === saved.id);
    setFocusRow({
      id:
        was !== undefined && visiblePending(was) === visiblePending(saved)
          ? saved.id
          : (waiting[at + 1]?.id ?? waiting[at - 1]?.id ?? null),
    });
    queryClient.setQueryData(
      inventoryKeys.mappings(organizationId, projectId),
      (current: typeof query.data) =>
        current === undefined
          ? current
          : {
              ...current,
              items: current.items.map((item) =>
                item.id === saved.id ? saved : item,
              ),
              counts: recount(
                current.items.map((item) =>
                  item.id === saved.id ? saved : item,
                ),
              ),
            },
    );
    void queryClient.invalidateQueries({
      queryKey: inventoryKeys.summary(organizationId, projectId),
    });
    setNotice(text);
  };
  const decide = useMutation({
    mutationFn: (input: { item: InventoryMapping; unmapped: boolean }) =>
      decideMapping(
        organizationId,
        projectId,
        input.item.id,
        input.unmapped
          ? { action: "unmapped" }
          : // The identifier on screen, so a suggestion replaced meanwhile is not confirmed unseen.
            {
              action: "confirm",
              ...(input.item.cpe === null ? {} : { cpe: input.item.cpe }),
              ...(input.item.cpe === null && input.item.purl !== null
                ? { purl: input.item.purl }
                : {}),
            },
      ),
    onMutate: () => {
      setNotice(null);
      suggest.reset();
    },
    onSuccess: (saved, input) => {
      changed(
        saved,
        input.unmapped
          ? `บันทึกว่า ${input.item.product} ไม่มี CPE/purl แล้ว`
          : `ยืนยัน CPE/purl ของ ${input.item.product} แล้ว`,
      );
    },
  });
  const suggest = useMutation({
    mutationFn: (item: InventoryMapping) =>
      suggestMapping(organizationId, projectId, item.id),
    onMutate: () => {
      setNotice(null);
      decide.reset();
    },
    onSuccess: ({ item }) => {
      changed(
        item,
        item.cpe === null
          ? `ไม่พบข้อเสนอของ ${item.product} ใน dictionary`
          : `พบข้อเสนอของ ${item.product} รอการยืนยัน`,
      );
    },
  });
  const busy = decide.isPending || suggest.isPending;
  useEffect(() => {
    if (focusRow === null || busy) return;
    const row =
      focusRow.id === null
        ? null
        : queue.current?.querySelector(
            `[data-testid="mapping-row-${focusRow.id}"]`,
          );
    const button = row?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    (button ?? pendingHeading.current)?.focus();
    setFocusRow(null);
  }, [focusRow, busy]);
  if (switched) return null;
  const data = query.data;
  const pending = data?.items.filter(visiblePending) ?? [];
  const decided =
    data?.items.filter(
      (item) => item.status !== "pending" && matches(item, search),
    ) ?? [];
  const canManage = data?.canManage === true;
  const filtering = search.trim() !== "" || proposal !== "all";
  const failure = decide.error ?? suggest.error;

  const columns = (open: boolean): DataTableColumn<InventoryMapping>[] => [
    {
      key: "inventory",
      header: "จาก inventory",
      cell: (item) => (
        <span>
          {item.vendor} · {item.product}
        </span>
      ),
    },
    {
      key: "proposal",
      header: open ? "ข้อเสนอ" : "ผลการยืนยัน",
      cell: (item) =>
        identifier(item) ?? (
          <span className="text-[13px] text-foreground-secondary">
            {open ? "ยังไม่มีข้อเสนอ" : "ไม่มี CPE/purl · ยังไม่ครอบคลุม"}
          </span>
        ),
    },
    {
      key: "detail",
      header: open ? "ความมั่นใจ" : "ที่มา",
      mono: open,
      cell: (item) =>
        open
          ? item.confidence === null
            ? "—"
            : `${String(Math.round(item.confidence * 100))}%`
          : item.source === null
            ? "—"
            : SOURCE_LABELS[item.source],
    },
    {
      key: "systems",
      header: "System",
      cell: (item) => (
        <span className="text-[13px]">{item.systems.join(", ")}</span>
      ),
    },
  ];
  const actions = (item: InventoryMapping) =>
    canManage ? (
      <div className="inline-flex flex-wrap justify-end gap-2 xl:flex-nowrap">
        {item.status === "pending" && item.cpe !== null ? (
          <Button
            size="sm"
            data-testid={`mapping-confirm-${item.id}`}
            disabled={busy}
            onClick={() => {
              decide.mutate({ item, unmapped: false });
            }}
          >
            ยืนยัน
          </Button>
        ) : null}
        {item.status === "pending" && item.cpe === null ? (
          <Button
            size="sm"
            variant="outline"
            data-testid={`mapping-suggest-${item.id}`}
            disabled={busy}
            onClick={() => {
              suggest.mutate(item);
            }}
          >
            ค้นข้อเสนอ
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          data-testid={`mapping-edit-${item.id}`}
          disabled={busy}
          onClick={(event) => {
            setEditing({ item, opener: event.currentTarget });
          }}
        >
          แก้ CPE/purl
        </Button>
        {item.status === "unmapped" ? null : (
          <Button
            size="sm"
            variant="ghost"
            data-testid={`mapping-none-${item.id}`}
            disabled={busy}
            onClick={() => {
              decide.mutate({ item, unmapped: true });
            }}
          >
            ไม่มี CPE/purl
          </Button>
        )}
      </div>
    ) : null;

  return (
    <Page>
      <PageHeader
        eyebrow="// inventory"
        scope={
          project === null
            ? undefined
            : { mark: project.name, label: project.name, tag: "โปรเจกต์" }
        }
        title="ยืนยัน CPE/purl"
        status={
          data === undefined ? undefined : (
            <>
              <span data-testid="mapping-status-pending">
                รอยืนยัน{" "}
                <span className="font-mono">{data.counts.pending}</span>
              </span>
              <span data-testid="mapping-status-confirmed">
                ยืนยันแล้ว{" "}
                <span className="font-mono">{data.counts.confirmed}</span>
              </span>
              <span data-testid="mapping-status-unmapped">
                ไม่มี CPE/purl{" "}
                <span className="font-mono">{data.counts.unmapped}</span>
              </span>
            </>
          )
        }
        titleRef={heading}
        titleTabIndex={-1}
        description='component ในคิวนี้ยังไม่ถูกนำไป match CVE และแสดงเป็น "ยังไม่ครอบคลุม" จนกว่าผู้ดูแล Project จะยืนยัน product ที่ยืนยันแล้วจะ map ให้อัตโนมัติในการ import ครั้งถัดไป'
        actions={
          <Button variant="outline" asChild>
            <Link
              data-testid="mapping-back-link"
              to={`/organizations/${organizationId}/projects/${projectId}/inventory`}
            >
              กลับไป Inventory
            </Link>
          </Button>
        }
      />
      {data !== undefined && !canManage ? (
        <p
          data-testid="mapping-restricted"
          className="text-sm text-foreground-secondary"
        >
          เฉพาะผู้ดูแล Project ยืนยันได้
        </p>
      ) : null}
      <div aria-live="polite" className="space-y-2">
        {notice === null ? null : (
          <Notice tone="success" data-testid="mapping-notice">
            {notice}
          </Notice>
        )}
        {failure === null ? null : (
          <Alert tone="error" data-testid="mapping-error">
            {inventoryErrorMessage(failure)}
          </Alert>
        )}
      </div>
      {query.isPending ? (
        <PageState
          kind="loading"
          label="กำลังโหลดคิวยืนยัน"
          layout="table"
          visibleLabel
        />
      ) : isInventoryAccessDenied(query.error) ? (
        <PageState
          kind="denied"
          data-testid="inventory-mapping-denied"
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
        <div ref={queue} className="space-y-6">
          <Field label="ค้นหา Vendor หรือ Product" className="w-[220px]">
            <Input
              type="search"
              data-testid="mapping-filter-search"
              placeholder="Vendor หรือ Product"
              maxLength={200}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </Field>
          <section
            aria-labelledby="mapping-pending-heading"
            className="space-y-3"
          >
            <SectionHeader
              id="mapping-pending-heading"
              headingRef={pendingHeading}
              headingTabIndex={-1}
              title={
                <>
                  รอยืนยัน{" "}
                  <span className="font-mono text-foreground-secondary">
                    {pending.length}
                  </span>
                </>
              }
              meta="ข้อเสนอจาก NVD CPE dictionary"
            />
            <SegmentedControl
              testId="mapping-proposal"
              label="ข้อเสนอ"
              value={proposal}
              options={PROPOSAL_OPTIONS}
              optionTestId={(value) => `mapping-proposal-${value}`}
              onChange={setProposal}
            />
            <DataTable
              ariaLabel="รอยืนยัน CPE/purl"
              columns={columns(true)}
              rows={pending}
              rowKey={(item) => item.id}
              rowTestId={(item) => `mapping-row-${item.id}`}
              rowActions={canManage ? actions : undefined}
              empty={
                filtering ? "ไม่มีรายการตามตัวกรอง" : "ไม่มีรายการรอยืนยัน"
              }
            />
            <p className="text-[13px] text-foreground-secondary">
              เลือก &quot;ไม่มี CPE/purl&quot; เมื่อ product นี้ไม่มีใน NVD หรือ
              OSV component นั้นจะแสดงเป็น &quot;ยังไม่ครอบคลุม&quot; ไม่ใช่
              &quot;ไม่พบ CVE&quot;
            </p>
          </section>
          <section
            aria-labelledby="mapping-decided-heading"
            className="space-y-3"
          >
            <SectionHeader
              id="mapping-decided-heading"
              title={
                <>
                  ตัดสินแล้ว{" "}
                  <span className="font-mono text-foreground-secondary">
                    {decided.length}
                  </span>
                </>
              }
            />
            <DataTable
              ariaLabel="ตัดสินแล้ว"
              columns={columns(false)}
              rows={decided}
              rowKey={(item) => item.id}
              rowTestId={(item) => `mapping-row-${item.id}`}
              rowActions={canManage ? actions : undefined}
              empty={
                search.trim() !== ""
                  ? "ไม่มีรายการตามตัวกรอง"
                  : "ยังไม่มีรายการที่ตัดสินแล้ว"
              }
            />
          </section>
        </div>
      )}
      {editing === null ? null : (
        <MappingDialog
          mapping={editing.item}
          scope={{ organizationId, projectId }}
          opener={editing.opener}
          fallbackFocus={heading}
          onCancel={() => {
            setEditing(null);
          }}
          onSaved={(saved) => {
            setEditing(null);
            changed(saved, `ยืนยัน CPE/purl ของ ${saved.product} แล้ว`);
          }}
        />
      )}
    </Page>
  );
}

function recount(items: InventoryMapping[]) {
  const counts = { pending: 0, confirmed: 0, unmapped: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}
