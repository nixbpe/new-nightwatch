import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { ActionNotice } from "../../components/ui/action-notice";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { DataTablePagination } from "../../components/ui/data-table";
import { SectionHeader } from "../../components/ui/section-header";
import {
  AUDIT_LOG_PAGE_SIZE,
  auditLogQueryKeys,
  fetchAuditActors,
  fetchAuditEvents,
  customRangeError,
  floorToMinute,
  parseAuditFilters,
  serializeAuditFilters,
  toListParams,
  type AuditFilters,
} from "../../lib/api/audit-log";
import {
  formatAuditDate,
  formatAuditTime,
  formatAuditTimestamp,
  usePreferences,
} from "../../lib/preferences";
import { ROLE_LABELS } from "../../lib/roles";
import { useOrganizationScope } from "../organization-members/useOrganizationScope";
import {
  DENIED_MESSAGES,
  retryAuditRead,
  useAuditAccess,
  useAuditDenial,
} from "./access";
import { AuditDenied } from "./AuditDenied";
import { AuditFilterBar, describeFilters } from "./AuditFilterBar";
import { AuditTable, type AuditListReturnState } from "./AuditTable";
import { filterIdentity } from "./filters";
import { ExportDialog } from "./ExportDialog";
import {
  adjustFilterSearch,
  EMPTY_REASON,
  LIST_FAILED_REASON,
  LOADING_REASON,
  RANGE_INVALID_REASON,
  IN_PROGRESS_REASON,
  MY_EXPORTS_ID,
  PERMISSION_CHANGED,
  REQUESTED_ANNOUNCEMENT,
} from "./exports";
import { MyExportsSection } from "./MyExportsSection";
import { RecordingScopeNote } from "./RecordingScopeNote";
import { useAuditExport } from "./useAuditExport";

const TITLE = "บันทึกกิจกรรมองค์กร";
const TITLE_FOCUS_CLASS =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function AuditLogPage() {
  const { organizationId } = useParams();
  if (organizationId === undefined) return null;
  // Keyed so filters, the pinned snapshot and announcements never carry over to another Organization (AC-07).
  return (
    <AuditLogForOrganization
      key={organizationId}
      organizationId={organizationId}
    />
  );
}

// `asOf` pins the snapshot the user is paging through. It applies to every page except
// `basePage`, the one page that must keep asking without it (0 for none): a page past the end
// has already asked unpinned and is about to be left.
type ListView = {
  identity: string;
  now: Date;
  asOf: string | undefined;
  basePage: number;
};

function AuditLogForOrganization({
  organizationId,
}: {
  organizationId: string;
}) {
  const access = useAuditAccess(organizationId);
  const { isCurrentScope, scopeCurrent } = useOrganizationScope(organizationId);
  const { deniedCode, report } = useAuditDenial(organizationId, isCurrentScope);
  const { preferences } = usePreferences();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const filters = parseAuditFilters(searchParams);

  // The relative range and the pinned snapshot belong to one filter set: a changed filter
  // starts over (no `asOf`, a new anchor); a page change keeps both (spec "Web").
  const identity = filterIdentity(filters);
  // AC-18, spec "API": coming back from a detail page reuses the snapshot the user left, so
  // the rows and the cached relative range are the same ones.
  const returnState = location.state as AuditListReturnState | null;
  const [view, setView] = useState<ListView>(() => {
    const snapshot = returnState?.snapshot;
    const sameFilters =
      returnState?.search !== undefined &&
      filterIdentity(
        parseAuditFilters(new URLSearchParams(returnState.search)),
      ) === identity;
    return snapshot !== undefined && sameFilters
      ? {
          identity,
          now: new Date(snapshot.now),
          asOf: snapshot.asOf,
          // Matches no page, so the pin applies to every page of this snapshot.
          basePage: 0,
        }
      : {
          identity,
          now: floorToMinute(new Date()),
          asOf: undefined,
          basePage: filters.page,
        };
  });
  let currentView = view;
  if (view.identity !== identity) {
    currentView = {
      identity,
      now: floorToMinute(new Date()),
      asOf: undefined,
      basePage: filters.page,
    };
    setView(currentView);
  }

  const [scopeInfo, setScopeInfo] = useState<{
    retainedFrom: string;
    recordingStartedAt: string;
  }>();
  const retainedDay =
    scopeInfo === undefined
      ? undefined
      : formatAuditDate(new Date(scopeInfo.retainedFrom), preferences);
  const rangeError = customRangeError(filters, retainedDay);

  const allowed = access.status === "allowed" && scopeCurrent;
  const reading = allowed && deniedCode === null;
  const listParams = toListParams(filters, {
    now: currentView.now,
    timeZone: preferences.timeZone,
    asOf: filters.page === currentView.basePage ? undefined : currentView.asOf,
  });
  const listKey = auditLogQueryKeys.events(organizationId, listParams);
  const list = useQuery({
    queryKey: listKey,
    queryFn: () => fetchAuditEvents(organizationId, listParams),
    enabled: reading && rangeError === undefined,
    retry: retryAuditRead,
  });
  const actors = useQuery({
    queryKey: auditLogQueryKeys.actors(organizationId),
    queryFn: () => fetchAuditActors(organizationId),
    enabled: reading,
    retry: retryAuditRead,
  });
  useEffect(() => {
    report(list.error);
  }, [list.error, report]);
  useEffect(() => {
    report(actors.error);
  }, [actors.error, report]);

  const exportReasonId = "audit-export-reason";
  const exportButton = useRef<HTMLButtonElement>(null);
  const exportsHeading = useRef<HTMLHeadingElement>(null);
  const filtersHeading = useRef<HTMLHeadingElement>(null);
  const exp = useAuditExport({
    organizationId,
    role: access.status === "allowed" ? access.role : null,
    reading,
    scopeCurrent,
    isCurrentScope,
    report,
    preferences,
  });

  const data =
    list.data?.organizationId === organizationId ? list.data : undefined;
  if (
    data !== undefined &&
    (scopeInfo?.retainedFrom !== data.retainedFrom ||
      scopeInfo.recordingStartedAt !== data.recordingStartedAt)
  ) {
    setScopeInfo({
      retainedFrom: data.retainedFrom,
      recordingStartedAt: data.recordingStartedAt,
    });
  }

  const titleRef = useRef<HTMLHeadingElement>(null);
  const tableHeadingRef = useRef<HTMLHeadingElement>(null);
  const rowLinks = useRef(new Map<string, HTMLAnchorElement>());
  const registerLink = (eventId: string, element: HTMLAnchorElement | null) => {
    if (element === null) rowLinks.current.delete(eventId);
    else rowLinks.current.set(eventId, element);
  };

  // Changes made before the router commits the previous one (same tick, or while a loader
  // runs) must stack: each starts from the params the last one wrote, not from the URL of
  // the last render (O1). The URL wins again once it actually changes.
  const latestParams = useRef(searchParams);
  const committedParams = useRef(searchParams.toString());
  if (committedParams.current !== searchParams.toString()) {
    committedParams.current = searchParams.toString();
    latestParams.current = searchParams;
  }
  const writeFilters = (update: (current: AuditFilters) => AuditFilters) => {
    const next = serializeAuditFilters(
      update(parseAuditFilters(latestParams.current)),
    );
    latestParams.current = next;
    setSearchParams(next, { replace: true });
  };
  const changeFilters = (change: Partial<AuditFilters>) => {
    writeFilters((current) => ({ ...current, ...change, page: 1 }));
  };
  const clearFilters = () => {
    writeFilters(() => ({ range: "7d", categories: [], page: 1 }));
  };
  // `unpinnedPage` is the page that must keep asking without `asOf`; paging by hand pins every
  // page of the snapshot (basePage 0), so none drifts after its cache goes stale.
  const goToPage = (page: number, unpinnedPage = 0) => {
    setView((previous) =>
      previous.asOf !== undefined || data === undefined
        ? previous
        : { ...previous, asOf: data.asOf, basePage: unpinnedPage },
    );
    writeFilters((current) => ({ ...current, page }));
    tableHeadingRef.current?.focus();
  };
  const refresh = () => {
    // AC-11: an invalid range sends no request, refresh included.
    if (rangeError !== undefined) return;
    const next: ListView = {
      identity,
      now: new Date(),
      asOf: undefined,
      basePage: filters.page,
    };
    const nextKey = auditLogQueryKeys.events(
      organizationId,
      toListParams(filters, { now: next.now, timeZone: preferences.timeZone }),
    );
    setView(next);
    // A custom range has no moving anchor, so its key can stay the same: ask again explicitly.
    if (JSON.stringify(nextKey) === JSON.stringify(listKey))
      void list.refetch();
    // The actor options (and who counts as a former member) change with the list.
    void actors.refetch();
  };

  // AC-18: coming back from a detail page puts focus on that row's link, else on the table heading.
  const returnedTo = returnState?.eventId;
  const restoredFocus = useRef(false);
  useEffect(() => {
    if (
      restoredFocus.current ||
      returnedTo === undefined ||
      data === undefined
    ) {
      return;
    }
    restoredFocus.current = true;
    (rowLinks.current.get(returnedTo) ?? tableHeadingRef.current)?.focus();
  }, [returnedTo, data]);

  // A page past the end answers with no rows and the real total: load the last page that has rows.
  const lastPage =
    data === undefined
      ? 1
      : Math.max(1, Math.ceil(data.page.total / AUDIT_LOG_PAGE_SIZE));
  const pastEnd =
    data !== undefined && data.events.length === 0 && data.page.total > 0;
  const redirectedFromPage = useRef<number | null>(null);
  useEffect(() => {
    if (!pastEnd || redirectedFromPage.current === filters.page) return;
    redirectedFromPage.current = filters.page;
    // The past-the-end page already asked without `asOf`; pinning it would refetch the page being left.
    goToPage(lastPage, filters.page);
  });

  const scope =
    access.status === "allowed"
      ? {
          mark: access.organizationName,
          label: access.organizationName,
          tag: ROLE_LABELS[access.role] ?? access.role,
        }
      : undefined;

  if (access.status === "loading" || !scopeCurrent) {
    return (
      <Page>
        <PageHeader eyebrow="// audit-log" title={TITLE} />
        <PageState
          kind="loading"
          label="กำลังโหลดบันทึกกิจกรรม"
          layout="table"
        />
      </Page>
    );
  }
  if (access.status === "error") {
    return (
      <Page>
        <PageHeader eyebrow="// audit-log" title={TITLE} />
        <PageState
          kind="error"
          message="ไม่สามารถยืนยันสิทธิ์ดูบันทึกกิจกรรมได้"
          onRetry={() => void access.retry()}
        />
      </Page>
    );
  }
  if (access.status === "denied" || deniedCode !== null) {
    const code =
      deniedCode ?? (access.status === "denied" ? access.code : null);
    return (
      <Page>
        <PageHeader eyebrow="// audit-log" title={TITLE} />
        <AuditDenied message={DENIED_MESSAGES[code ?? "PERMISSION_DENIED"]} />
      </Page>
    );
  }

  const loading =
    rangeError === undefined &&
    data === undefined &&
    (list.isFetching || !list.isError);
  const since =
    scopeInfo === undefined
      ? undefined
      : formatAuditDate(new Date(scopeInfo.recordingStartedAt), preferences);
  const totalText =
    data === undefined ? null : data.page.total.toLocaleString("en-US");
  // "No data" is claimed only when the actors endpoint (events within retention) is known to be
  // empty too; while it is loading or failed, an empty list reads as "no match".
  const noData =
    actors.isSuccess && !actors.isFetching && actors.data.actors.length === 0;

  // M-4: the export asks for exactly what the list shows: absolute from/to and the list's asOf.
  const exportFrom = (retainedFrom: string) => listParams.from ?? retainedFrom;
  const exportTo = (asOf: string) => listParams.to ?? asOf;
  // N-2: one reason element explains every state in which ส่งออก cannot be used.
  const exportReason = exp.inProgress
    ? IN_PROGRESS_REASON
    : rangeError !== undefined
      ? RANGE_INVALID_REASON
      : loading || pastEnd
        ? LOADING_REASON
        : data === undefined
          ? LIST_FAILED_REASON
          : data.page.total === 0
            ? EMPTY_REASON
            : null;
  const exportBlocked = exportReason !== null;

  let body;
  if (rangeError !== undefined) {
    body = (
      <p className="text-sm text-foreground-secondary">
        ช่วงวันที่ไม่ถูกต้อง แก้ไขช่วงวันที่เพื่อแสดงรายการ
      </p>
    );
  } else if (loading || pastEnd) {
    body = (
      <PageState kind="loading" label="กำลังโหลดบันทึกกิจกรรม" layout="table" />
    );
  } else if (data === undefined) {
    body = (
      <PageState
        kind="error"
        message="โหลดบันทึกกิจกรรมไม่สำเร็จ ตัวกรองของคุณยังอยู่ ลองใหม่อีกครั้ง"
        onRetry={() => void list.refetch()}
      />
    );
  } else if (data.page.total === 0) {
    body = (
      <Card padding="md">
        <p className="text-sm">
          {!noData
            ? "ไม่พบบันทึกที่ตรงกับตัวกรองนี้ ลองขยายช่วงเวลาหรือล้างตัวกรอง"
            : `ยังไม่มีบันทึกกิจกรรมในช่วงที่เก็บไว้ (ถึง ${formatAuditDate(new Date(data.retainedFrom), preferences)}) ข้อความนี้ไม่ได้ยืนยันว่าไม่มีกิจกรรมในหมวดที่ไม่ได้บันทึก`}
        </p>
        {!noData ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                clearFilters();
              }}
            >
              ล้างตัวกรอง
            </Button>
          </div>
        ) : null}
      </Card>
    );
  } else {
    const pageCount = lastPage;
    body = (
      <>
        <AuditTable
          organizationId={organizationId}
          events={data.events}
          preferences={preferences}
          search={
            searchParams.toString() === "" ? "" : `?${searchParams.toString()}`
          }
          snapshot={{ asOf: data.asOf, now: currentView.now.toISOString() }}
          registerLink={registerLink}
        />
        <DataTablePagination
          ariaLabel="หน้าบันทึกกิจกรรม"
          summary={
            <>
              ทั้งหมด {totalText} รายการ · หน้า {filters.page} จาก {pageCount}
            </>
          }
          previousLabel="ก่อนหน้า"
          nextLabel="ถัดไป"
          hasPrevious={filters.page > 1}
          hasNext={filters.page < pageCount}
          onPrevious={() => {
            goToPage(filters.page - 1);
          }}
          onNext={() => {
            goToPage(filters.page + 1);
          }}
        />
      </>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="// audit-log"
        scope={scope}
        title={TITLE}
        titleRef={titleRef}
        titleTabIndex={-1}
        titleClassName={TITLE_FOCUS_CLASS}
        status={
          <>
            {totalText === null ? null : (
              <span>
                ทั้งหมด <span className="font-mono">{totalText}</span> รายการ
              </span>
            )}
            {retainedDay === undefined ? null : (
              <span>
                เก็บย้อนหลังถึง <span className="font-mono">{retainedDay}</span>
              </span>
            )}
            <span>
              เวลาแสดงตาม{" "}
              <span className="font-mono">{preferences.timeZone}</span>
            </span>
            {data === undefined ? null : (
              <span>
                โหลดเมื่อ{" "}
                <span className="font-mono">
                  {formatAuditTime(new Date(data.asOf), preferences)}
                </span>
              </span>
            )}
          </>
        }
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              aria-disabled={
                loading || rangeError !== undefined ? true : undefined
              }
              aria-describedby={
                rangeError === undefined
                  ? undefined
                  : "audit-custom-range-error"
              }
              onClick={() => {
                if (!loading) refresh();
              }}
            >
              รีเฟรช
            </Button>
            {exp.canExport ? (
              <Button
                ref={exportButton}
                type="button"
                aria-disabled={exportBlocked ? true : undefined}
                aria-describedby={
                  exportReason === null ? undefined : exportReasonId
                }
                onClick={() => {
                  if (!exportBlocked) exp.openDialog(exportButton.current);
                }}
              >
                {exp.inProgress ? "กำลังสร้างไฟล์…" : "ส่งออก"}
              </Button>
            ) : null}
          </>
        }
      />
      <p role="status" data-slot="export-announcement" className="sr-only">
        {exp.canExport && exp.requestedNotice ? REQUESTED_ANNOUNCEMENT : ""}
      </p>
      {exp.canExport && exportReason !== null ? (
        <p id={exportReasonId} className="text-sm text-foreground-secondary">
          {exportReason}
        </p>
      ) : null}
      {exp.canExport && exp.requestedNotice ? (
        <ActionNotice
          live={false}
          onClose={() => {
            exp.dismissRequestedNotice();
            exportButton.current?.focus();
          }}
          actions={
            <a
              href={`#${MY_EXPORTS_ID}`}
              onClick={(event) => {
                event.preventDefault();
                exportsHeading.current?.focus();
              }}
              className="rounded-[4px] text-primary underline-offset-4 hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              ดูไฟล์ส่งออกของฉัน
            </a>
          }
        >
          กำลังสร้างไฟล์ เราจะแจ้งใน{" "}
          <Link
            to="/notifications"
            className="text-primary underline-offset-4 hover:underline"
          >
            การแจ้งเตือน
          </Link>{" "}
          เมื่อพร้อมดาวน์โหลด
        </ActionNotice>
      ) : null}
      <RecordingScopeNote since={since} />
      <section
        aria-labelledby="audit-filters-title"
        className="flex flex-col gap-4"
      >
        <SectionHeader
          id="audit-filters-title"
          code="01"
          title="ตัวกรอง"
          headingRef={filtersHeading}
          headingTabIndex={-1}
          headingClassName={`w-fit rounded-[4px] ${TITLE_FOCUS_CLASS}`}
        />
        <AuditFilterBar
          filters={filters}
          actors={actors.data?.actors ?? []}
          busy={loading}
          customError={rangeError}
          retainedDay={retainedDay}
          onChange={changeFilters}
          onClear={() => {
            clearFilters();
          }}
        />
      </section>
      <section
        aria-labelledby="audit-list-title"
        className="flex flex-col gap-4"
      >
        <SectionHeader
          id="audit-list-title"
          code="02"
          title="รายการ"
          headingRef={tableHeadingRef}
          headingTabIndex={-1}
          headingClassName={`w-fit rounded-[4px] ${TITLE_FOCUS_CLASS}`}
        />
        <p role="status" className="sr-only">
          {data === undefined || pastEnd ? "" : `พบ ${totalText ?? ""} รายการ`}
        </p>
        {exp.revoked ? (
          <ActionNotice focusable ref={exp.permissionNotice}>
            {PERMISSION_CHANGED}
          </ActionNotice>
        ) : null}
        {body}
      </section>
      {exp.canExport ? (
        <MyExportsSection
          rows={exp.rows}
          loading={exp.query.isPending}
          failedWithoutRows={exp.query.isError && exp.rows === undefined}
          pollFailed={exp.query.isError && exp.rows !== undefined}
          onRetryList={() => void exp.query.refetch()}
          inProgress={exp.inProgress}
          reasonId={exportReasonId}
          announcement={exp.announcement}
          actors={actors.data?.actors}
          preferences={preferences}
          headingRef={exportsHeading}
          buttonSuffix={exp.rowButtonSuffix}
          onRetryRow={exp.retryRow}
          onDownload={exp.downloadRow}
          onAdjustFilters={(record) => {
            setSearchParams(adjustFilterSearch(record, preferences), {
              replace: true,
            });
            filtersHeading.current?.focus();
          }}
        />
      ) : null}
      {exp.dialog !== null && data !== undefined ? (
        <ExportDialog
          scope={{
            loadedAt: formatAuditTime(new Date(data.asOf), preferences),
            timeZone: preferences.timeZone,
            rangeText: `${formatAuditTimestamp(new Date(exportFrom(data.retainedFrom)), preferences)} – ${formatAuditTimestamp(new Date(exportTo(data.asOf)), preferences)}`,
            filtersText: describeFilters(filters, actors.data?.actors ?? []),
            total: data.page.total,
            recordingSince: since,
          }}
          opener={exp.dialog.opener}
          fallbackFocus={titleRef}
          onSubmit={(format) =>
            exp.submitFromDialog({
              format,
              timeZone: preferences.timeZone,
              filters: {
                from: exportFrom(data.retainedFrom),
                to: exportTo(data.asOf),
                ...(listParams.categories === undefined
                  ? {}
                  : { categories: [...listParams.categories] }),
                ...(listParams.actorUserId === undefined
                  ? {}
                  : { actorUserId: listParams.actorUserId }),
                ...(listParams.q === undefined ? {} : { q: listParams.q }),
              },
              asOf: data.asOf,
            })
          }
          onCancel={exp.closeDialog}
        />
      ) : null}
    </Page>
  );
}
