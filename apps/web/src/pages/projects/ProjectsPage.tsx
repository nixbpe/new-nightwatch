import {
  PROJECT_LIMIT_PER_ORGANIZATION,
  type ProjectSummary,
} from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import { EmptyState } from "../../components/shell/EmptyState";
import { GridIcon, SearchIcon } from "../../components/shell/icons";
import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Alert, Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/ui/data-table";
import { Label } from "../../components/ui/label";
import { Notice } from "../../components/ui/notice";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { StatusPill } from "../../components/ui/status-pill";
import { ApiError } from "../../lib/api/client";
import {
  deleteProject,
  fetchProjectList,
  projectQueryKeys,
} from "../../lib/api/projects";
import { formatAuditDate, formatAuditTime } from "../../lib/preferences";
import { usePreferences } from "../../lib/preferences";
import { ROLE_LABELS } from "../../lib/roles";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { isDenied } from "../workspace/rows";
import {
  LIMIT_REACHED_MESSAGE,
  ProjectFormDialog,
  type StaleReason,
} from "./ProjectFormDialog";

const SEARCH_DEBOUNCE_MS = 300;
const VIEW_OPTIONS = [
  { value: "all", label: "ทั้งหมด" },
  { value: "mine", label: "ที่ฉันเข้าร่วม" },
] as const;
type View = (typeof VIEW_OPTIONS)[number]["value"];

// Says only what the denied write proved; the list's own loading, stale and
// error states report the reload.
const ROLE_CHANGED = "สิทธิ์ของคุณในองค์กรเปลี่ยนไป";
const DELETE_FAILED = "ลบโปรเจกต์ไม่สำเร็จ ลองอีกครั้ง";

type Dialog =
  | { kind: "create"; opener: HTMLElement | null }
  | { kind: "edit"; project: ProjectSummary; opener: HTMLElement | null };
type Deletion = {
  project: ProjectSummary;
  opener: HTMLElement | null;
  pending: boolean;
  failed: boolean;
};

export function ProjectsPage() {
  const { organizationId } = useParams();
  if (organizationId === undefined) return null;
  // Keyed so filters and dialogs never carry over to another Organization.
  return (
    <ProjectsForOrganization
      key={organizationId}
      organizationId={organizationId}
    />
  );
}

function projectNoticeOf(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const notice = (state as { projectNotice?: unknown }).projectNotice;
  return typeof notice === "string" && notice !== "" ? notice : null;
}

function RolePill({ role }: { role: ProjectSummary["myRole"] }) {
  const hooks = {
    "data-testid": "project-role",
    "data-project-role": role ?? "none",
  };
  if (role === "admin") {
    return (
      <StatusPill {...hooks} tone="primary" dot>
        ผู้ดูแล
      </StatusPill>
    );
  }
  if (role === "member") {
    return (
      <StatusPill {...hooks} tone="neutral" dot>
        สมาชิก
      </StatusPill>
    );
  }
  return (
    <StatusPill {...hooks} tone="muted">
      ไม่ได้เข้าร่วม
    </StatusPill>
  );
}

function ProjectsForOrganization({
  organizationId,
}: {
  organizationId: string;
}) {
  const { me, mePending, meError, refreshMembershipContext } = useTenant();
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const organization = me?.organizations.find(
    (item) => item.id === organizationId,
  );
  const isMember = organization !== undefined;
  // Set by the Project pages when they send the user back after a 404.
  const location = useLocation();
  const navigate = useNavigate();
  const arrivalNotice = projectNoticeOf(location.state);

  const [view, setView] = useState<View>("all");
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const [notice, setNotice] = useState<{
    text: string;
    kind: "saved" | "role-changed";
  } | null>(
    arrivalNotice === null
      ? null
      : { text: arrivalNotice, kind: "role-changed" },
  );
  const [contextRefresh, setContextRefresh] = useState<
    "idle" | "refreshing" | "done"
  >("idle");
  const heading = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Arriving with a notice moves focus to the heading, so it is read first.
  // The notice is read once into state, then dropped from history so a reload
  // or back/forward does not replay it.
  useEffect(() => {
    if (arrivalNotice === null) return;
    heading.current?.focus();
    void navigate(location.pathname, { replace: true, state: null });
  }, [arrivalNotice, navigate, location.pathname]);

  const list = useQuery({
    queryKey: projectQueryKeys.list(organizationId),
    queryFn: () => fetchProjectList(organizationId),
    enabled: isMember,
  });
  const projects = list.data?.projects;

  useEffect(() => {
    if (searchText.trim() === q) return;
    const timer = setTimeout(() => {
      setQ(searchText.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [searchText, q]);

  const denied = isDenied(list.error);
  useEffect(() => {
    if (!denied || contextRefresh !== "idle") return;
    setContextRefresh("refreshing");
    void refreshMembershipContext().finally(() => {
      setContextRefresh("done");
    });
  }, [denied, contextRefresh, refreshMembershipContext]);

  const canManage =
    organization?.role === "owner" || organization?.role === "admin";
  const joined = projects?.filter((project) => project.myRole !== null) ?? [];
  const needle = q.toLowerCase();
  const visible = (projects ?? []).filter(
    (project) =>
      (view === "all" || project.myRole !== null) &&
      (needle === "" ||
        project.name.toLowerCase().includes(needle) ||
        project.slug.toLowerCase().includes(needle)),
  );
  const filtered = view !== "all" || q !== "";

  // Only a filter or search change announces; a refetch leaves the text alone.
  useEffect(() => {
    if (projects === undefined) return;
    if (!filtered) {
      setAnnouncement("");
      return;
    }
    setAnnouncement(
      `พบ ${String(visible.length)} จาก ${String(projects.length)}`,
    );
  }, [projects, filtered, visible.length]);

  const clearFilters = () => {
    setSearchText("");
    setQ("");
    setView("all");
    setAnnouncement("");
    // The clear button unmounts with the no-results state; keep focus on a stable control.
    searchRef.current?.focus();
  };

  // A write that answers 403, or 404 for a Project the user can no longer see,
  // may mean the role changed, so the context reloads before the list. The
  // context refresh cancels tenant queries, and removes them when the
  // Organization role changed so the list observer refetches; the list reload
  // runs after it and joins that fetch.
  const reload = () => {
    void refreshMembershipContext().finally(() => {
      void queryClient.invalidateQueries(
        { queryKey: projectQueryKeys.all(organizationId) },
        { cancelRefetch: false },
      );
    });
  };

  // Reloads the list and says so only once the list shows the result; a failed
  // reload leaves the stale list warning to speak for the page.
  const reloadThenNotify = async (text: string) => {
    const reloaded = await queryClient
      .invalidateQueries(
        { queryKey: projectQueryKeys.all(organizationId) },
        { throwOnError: true },
      )
      .then(
        () => true,
        () => false,
      );
    setNotice(reloaded ? { text, kind: "saved" } : null);
  };

  // The Project answered 404: drop what is cached for it, not only the list.
  const forgetProject = async (projectId: string) => {
    queryClient.removeQueries({
      queryKey: projectQueryKeys.project(organizationId, projectId),
    });
    // A list fetch still in flight would be cancelled by the context refresh
    // that follows, and cancelling restores the data it started from, the row
    // included. Cancel it first so the filter below is what stays.
    await queryClient.cancelQueries({
      queryKey: projectQueryKeys.list(organizationId),
    });
    // The list reload may fail; the row must not outlive the 404 either way.
    queryClient.setQueryData<{ projects: ProjectSummary[] }>(
      projectQueryKeys.list(organizationId),
      (list) =>
        list && {
          ...list,
          projects: list.projects.filter((item) => item.id !== projectId),
        },
    );
  };

  const roleChanged = () => {
    setNotice({ text: ROLE_CHANGED, kind: "role-changed" });
    reload();
  };

  const confirmDelete = async () => {
    if (deletion === null || deletion.pending) return;
    const { project } = deletion;
    setDeletion({ ...deletion, pending: true, failed: false });
    try {
      await deleteProject(organizationId, project.id);
    } catch (error) {
      if (error instanceof ApiError) {
        if (
          error.code === "PERMISSION_DENIED" ||
          error.code === "MEMBERSHIP_DENIED"
        ) {
          setDeletion(null);
          roleChanged();
          return;
        }
        if (error.code === "PROJECT_NOT_FOUND") {
          setDeletion(null);
          void forgetProject(project.id).then(reload);
          return;
        }
      }
      setDeletion({
        project,
        opener: deletion.opener,
        pending: false,
        failed: true,
      });
      return;
    }
    await reloadThenNotify(`ลบโปรเจกต์ ${project.name} แล้ว`);
    setDeletion(null);
  };

  const header = (actions?: ReactNode, status?: ReactNode) => (
    <>
      <PageHeader
        eyebrow="// PROJECTS"
        scope={
          organization === undefined
            ? undefined
            : {
                mark: organization.name,
                label: organization.name,
                tag: ROLE_LABELS[organization.role] ?? organization.role,
              }
        }
        title="โปรเจกต์"
        status={status}
        description="จัดคนในองค์กรเป็นกลุ่มงาน สมาชิกของโปรเจกต์เลือกได้จากสมาชิกขององค์กรเท่านั้น และมีบทบาท ผู้ดูแล หรือ สมาชิก"
        actions={actions}
        titleRef={heading}
        titleTabIndex={-1}
        titleDescribedBy={
          notice?.kind === "role-changed" ? "projects-notice" : undefined
        }
      />
      {notice === null ? null : notice.kind === "role-changed" ? (
        <Alert
          id="projects-notice"
          data-testid="projects-notice-role-changed"
          tone="info"
          role="status"
        >
          {notice.text}
        </Alert>
      ) : (
        <Notice data-testid="projects-notice-saved" tone="success">
          {notice.text}
        </Notice>
      )}
    </>
  );

  if (mePending || contextRefresh === "refreshing") {
    return (
      <Page>
        {header()}
        <PageState
          data-testid="projects-loading"
          statusTestId="projects-loading-status"
          kind="loading"
          label="กำลังโหลดโปรเจกต์"
          layout="table"
        />
      </Page>
    );
  }
  if (meError !== null) {
    return (
      <Page>
        {header()}
        <PageState
          data-testid="projects-context-error"
          alertTestId="projects-context-alert"
          retryTestId="projects-context-retry"
          kind="error"
          message="ไม่สามารถยืนยันสิทธิ์ดูโปรเจกต์ได้"
          retryLabel="ลองอีกครั้ง"
          onRetry={() => void refreshMembershipContext()}
        />
      </Page>
    );
  }
  if (organization === undefined || denied) {
    // No scope row, name or count: a non-member learns nothing about this Organization.
    return (
      <Page>
        <PageHeader
          eyebrow="// PROJECTS"
          title="โปรเจกต์"
          titleRef={heading}
          titleTabIndex={-1}
        />
        <PageState
          data-testid="projects-denied"
          alertTestId="projects-denied-alert"
          kind="denied"
          message="คุณไม่มีสิทธิ์ดูโปรเจกต์ขององค์กรนี้"
        />
      </Page>
    );
  }
  if (projects === undefined) {
    return (
      <Page>
        {header()}
        {list.isError ? (
          <PageState
            data-testid="projects-list-error"
            alertTestId="projects-list-alert"
            retryTestId="projects-list-retry"
            kind="error"
            message="โหลดโปรเจกต์ไม่สำเร็จ"
            retryLabel="ลองอีกครั้ง"
            onRetry={() => void list.refetch()}
          />
        ) : (
          <PageState
            data-testid="projects-loading"
            statusTestId="projects-loading-status"
            kind="loading"
            label="กำลังโหลดโปรเจกต์"
            layout="table"
          />
        )}
      </Page>
    );
  }

  const openCreate = (opener: HTMLElement) => {
    setNotice(null);
    setDialog({ kind: "create", opener });
  };
  const limitReached = projects.length >= PROJECT_LIMIT_PER_ORGANIZATION;
  const createButton = (
    <Button
      data-testid="projects-create"
      type="button"
      onClick={(event) => {
        openCreate(event.currentTarget);
      }}
    >
      สร้างโปรเจกต์
    </Button>
  );
  const actions = !canManage ? undefined : limitReached ? (
    <>
      <span
        data-testid="projects-limit-reason"
        id="project-limit-reason"
        className="text-xs text-foreground-secondary"
      >
        {LIMIT_REACHED_MESSAGE}
      </span>
      <Button
        data-testid="projects-create"
        type="button"
        disabled
        aria-describedby="project-limit-reason"
      >
        สร้างโปรเจกต์
      </Button>
    </>
  ) : projects.length === 0 ? undefined : (
    createButton
  );
  const status = (
    <span>
      <span data-testid="projects-total" className="font-mono">
        {projects.length}
      </span>{" "}
      โปรเจกต์ · คุณเข้าร่วม{" "}
      <span data-testid="projects-joined" className="font-mono">
        {joined.length}
      </span>{" "}
      โปรเจกต์
    </span>
  );

  const columns: DataTableColumn<ProjectSummary>[] = [
    {
      key: "project",
      header: "โปรเจกต์",
      cell: (project) => (
        <span className="flex min-w-40 flex-col">
          <span data-testid="project-name" className="font-medium break-words">
            <Link
              data-testid="project-members-link"
              className="rounded-[4px] underline-offset-4 hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              to={`/organizations/${organizationId}/projects/${project.id}/members`}
            >
              {project.name}
            </Link>
          </span>
          <span
            data-testid="project-slug"
            className="font-mono text-[13px] whitespace-nowrap text-foreground-secondary"
          >
            {project.slug}
          </span>
        </span>
      ),
    },
    {
      key: "members",
      header: "สมาชิก",
      width: "120px",
      align: "end",
      mono: true,
      cell: (project) => (
        <span data-testid="project-member-count">{project.memberCount}</span>
      ),
    },
    {
      key: "role",
      header: "บทบาทของคุณ",
      width: "180px",
      cell: (project) => <RolePill role={project.myRole} />,
    },
    {
      key: "updatedAt",
      header: "อัปเดตล่าสุด",
      width: "200px",
      mono: true,
      cell: (project) => {
        const at = new Date(project.updatedAt);
        return (
          <time
            data-testid="project-updated-at"
            dateTime={project.updatedAt}
            className="text-foreground-secondary"
          >
            {formatAuditDate(at, preferences)}{" "}
            {formatAuditTime(at, preferences).slice(0, 5)}
          </time>
        );
      },
    },
  ];
  const rowActions = (project: ProjectSummary) => {
    const canEdit = canManage || project.myRole === "admin";
    if (!canEdit) return null;
    return (
      <span className="inline-flex justify-end gap-2">
        <Button
          data-testid="project-edit"
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`แก้ไข ${project.name}`}
          onClick={(event) => {
            setNotice(null);
            setDialog({
              kind: "edit",
              project,
              opener: event.currentTarget,
            });
          }}
        >
          แก้ไข
        </Button>
        {canManage ? (
          <Button
            data-testid="project-delete"
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`ลบ ${project.name}`}
            onClick={(event) => {
              setNotice(null);
              setDeletion({
                project,
                opener: event.currentTarget,
                pending: false,
                failed: false,
              });
            }}
          >
            ลบ
          </Button>
        ) : null}
      </span>
    );
  };

  let body: ReactNode;
  if (projects.length === 0) {
    body = canManage ? (
      <EmptyState
        data-testid="projects-empty-first-run"
        variant="first-run"
        icon={<GridIcon size={20} />}
        title="ยังไม่มีโปรเจกต์"
        action={createButton}
      />
    ) : (
      <EmptyState
        data-testid="projects-empty-not-joined"
        icon={<GridIcon size={20} />}
        title="คุณยังไม่ได้อยู่ในโปรเจกต์ใด"
        description="ติดต่อเจ้าของหรือผู้ดูแลองค์กรเพื่อเข้าร่วมโปรเจกต์"
      />
    );
  } else {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-3">
          <Label className="relative block w-80 max-w-full">
            <span className="sr-only">ค้นหาโปรเจกต์</span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-foreground-secondary"
            >
              <SearchIcon size={18} />
            </span>
            <Input
              data-testid="projects-search"
              type="search"
              ref={searchRef}
              value={searchText}
              maxLength={200}
              className="pl-10"
              placeholder="ค้นหาด้วยชื่อหรือ slug"
              onChange={(event) => {
                setSearchText(event.target.value);
              }}
            />
          </Label>
          <SegmentedControl
            testId="projects-view"
            optionTestId={(value) => `projects-view-${value}`}
            label="แสดงโปรเจกต์"
            value={view}
            options={VIEW_OPTIONS}
            onChange={setView}
          />
        </div>
        <p
          data-testid="projects-filter-result"
          role="status"
          aria-label="ผลการกรอง"
          className="sr-only"
        >
          {announcement}
        </p>
        {visible.length === 0 ? (
          <EmptyState
            data-testid="projects-no-results"
            icon={<GridIcon size={20} />}
            title="ไม่พบโปรเจกต์ที่ตรงกับตัวกรอง"
            action={
              <Button
                data-testid="projects-clear-filters"
                type="button"
                variant="secondary"
                onClick={clearFilters}
              >
                ล้างตัวกรอง
              </Button>
            }
          />
        ) : (
          <DataTable
            data-testid="projects-table"
            rowTestId={(project) => `project-row-${project.id}`}
            ariaLabel="รายการโปรเจกต์"
            columns={columns}
            rows={visible}
            rowKey={(project) => project.id}
            rowActions={rowActions}
          />
        )}
      </>
    );
  }

  return (
    <Page>
      {header(actions, status)}
      {list.isError ? (
        <Alert data-testid="projects-stale-warning" tone="warning">
          อัปเดตรายการไม่สำเร็จ กำลังแสดงรายการที่โหลดไว้ก่อนหน้า
        </Alert>
      ) : null}
      {body}
      {dialog === null ? null : (
        <ProjectFormDialog
          organizationId={organizationId}
          project={dialog.kind === "edit" ? dialog.project : undefined}
          opener={dialog.opener}
          fallbackFocus={heading}
          onSaved={async (saved) => {
            await reloadThenNotify(
              dialog.kind === "edit"
                ? `บันทึกโปรเจกต์ ${saved.name} แล้ว`
                : `สร้างโปรเจกต์ ${saved.name} แล้ว`,
            );
            setDialog(null);
          }}
          onCancel={() => {
            setDialog(null);
          }}
          onStale={(reason: StaleReason) => {
            setDialog(null);
            if (reason === "denied") roleChanged();
            else if (dialog.kind === "edit") {
              void forgetProject(dialog.project.id).then(reload);
            } else reload();
          }}
        />
      )}
      {deletion === null ? null : (
        <ConfirmDialog
          data-testid="project-delete-dialog"
          confirmTestId="project-delete-confirm"
          title={`ลบโปรเจกต์ ${deletion.project.name}`}
          description={
            <>
              <p>
                มอนิเตอร์ สมาชิก และการเชื่อมต่อ AWS ของโปรเจกต์นี้จะถูกลบด้วย
                และกู้คืนไม่ได้
              </p>
              {deletion.failed ? (
                <p
                  data-testid="project-delete-error"
                  role="alert"
                  className="mt-2 text-danger"
                >
                  {DELETE_FAILED}
                </p>
              ) : null}
            </>
          }
          confirmLabel="ลบโปรเจกต์"
          confirmVariant="destructive"
          pendingLabel="กำลังลบโปรเจกต์…"
          pending={deletion.pending}
          opener={deletion.opener}
          fallbackFocus={heading}
          onCancel={() => {
            setDeletion(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </Page>
  );
}
