import type { ProjectMember, ProjectRole } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { SearchIcon } from "../../../components/shell/icons";
import { initialsOf } from "../../../components/shell/initials";
import { Page, PageHeader } from "../../../components/shell/Page";
import { PageState } from "../../../components/shell/PageState";
import { Alert, Input, textInputClass } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import {
  DataTable,
  type DataTableColumn,
} from "../../../components/ui/data-table";
import { Label } from "../../../components/ui/label";
import { Notice } from "../../../components/ui/notice";
import { ApiError } from "../../../lib/api/client";
import {
  fetchProjectDetail,
  fetchProjectMembers,
  projectQueryKeys,
  removeProjectMember,
  updateProjectMemberRole,
} from "../../../lib/api/projects";
import { formatAuditDate, usePreferences } from "../../../lib/preferences";
import { ROLE_LABELS } from "../../../lib/roles";
import { useTenant } from "../../../lib/tenant/TenantProvider";
import { useLeaveOnOrganizationSwitch } from "../../monitors/useLeaveOnOrganizationSwitch";
import { isDenied } from "../../workspace/rows";
import { AddMemberDialog, type AddStaleReason } from "./AddMemberDialog";
import { PROJECT_ROLE_DESCRIPTIONS, PROJECT_ROLE_LABELS } from "./roles";

export const LAST_ADMIN_CHANGE_MESSAGE =
  "ต้องมีผู้ดูแลอย่างน้อย 1 คน เปลี่ยนบทบาทผู้ดูแลคนสุดท้ายไม่ได้";
export const LAST_ADMIN_REMOVE_MESSAGE =
  "ต้องมีผู้ดูแลอย่างน้อย 1 คน นำผู้ดูแลคนสุดท้ายออกไม่ได้";
const MEMBER_GONE_MESSAGE = "ไม่พบสมาชิกคนนี้ในโปรเจกต์แล้ว";
const ROLE_FAILED_MESSAGE = "เปลี่ยนบทบาทไม่สำเร็จ ลองอีกครั้ง";
const REMOVE_FAILED_MESSAGE = "นำสมาชิกออกไม่สำเร็จ ลองอีกครั้ง";
const ROLE_CHANGED = "สิทธิ์ของคุณเปลี่ยนไป";

const ROLES: readonly ProjectRole[] = ["admin", "member"];

type Removal = {
  member: ProjectMember;
  opener: HTMLElement | null;
  pending: boolean;
  error: string | null;
};

export function ProjectMembersPage() {
  const { organizationId, projectId } = useParams();
  if (organizationId === undefined || projectId === undefined) return null;
  // Keyed so search, dialogs and notices never carry over to another Project.
  return (
    <ProjectMembers
      key={`${organizationId}/${projectId}`}
      organizationId={organizationId}
      projectId={projectId}
    />
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === "PROJECT_NOT_FOUND";
}

function ProjectMembers({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { me, mePending, meError, refreshMembershipContext } = useTenant();
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const organization = me?.organizations.find(
    (item) => item.id === organizationId,
  );
  const isMember = organization !== undefined;
  // A Project belongs to one Organization: a switch made in the shell leaves for the new one's list.
  const switchedOrganization = useLeaveOnOrganizationSwitch(
    organizationId,
    "projects",
  );

  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<{ opener: HTMLElement | null } | null>(
    null,
  );
  const [removal, setRemoval] = useState<Removal | null>(null);
  // One role change at a time; the select shows the requested role until it settles.
  const [pendingRole, setPendingRole] = useState<{
    userId: string;
    role: ProjectRole;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    text: string;
    kind: "saved" | "role-changed" | "stale";
  } | null>(null);
  const [contextRefresh, setContextRefresh] = useState<
    "idle" | "refreshing" | "done"
  >("idle");
  const heading = useRef<HTMLHeadingElement>(null);
  const refocusUserId = useRef<string | null>(null);
  // Set when the user removes themself and loses access: says so instead of a bare not-found.
  const [leftProject, setLeftProject] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: projectQueryKeys.detail(organizationId, projectId),
    queryFn: () => fetchProjectDetail(organizationId, projectId),
    enabled: isMember && !switchedOrganization,
  });
  const membersQuery = useQuery({
    queryKey: projectQueryKeys.members(organizationId, projectId),
    queryFn: () => fetchProjectMembers(organizationId, projectId),
    enabled: isMember && !switchedOrganization,
  });
  const project = detail.data;
  const members = membersQuery.data?.members;

  const notFound = isNotFound(detail.error) || isNotFound(membersQuery.error);
  const denied = isDenied(detail.error) || isDenied(membersQuery.error);
  useEffect(() => {
    if (!denied || contextRefresh !== "idle") return;
    setContextRefresh("refreshing");
    void refreshMembershipContext().finally(() => {
      setContextRefresh("done");
    });
  }, [denied, contextRefresh, refreshMembershipContext]);

  // Returns focus to a select that the refetch remounted; with no select left
  // (the user demoted themself), the heading keeps focus on the page.
  useEffect(() => {
    if (pendingRole !== null || refocusUserId.current === null) return;
    const target = document.querySelector<HTMLElement>(
      `[data-testid="project-member-role-select"][data-user-id="${CSS.escape(refocusUserId.current)}"]`,
    );
    (target ?? heading.current)?.focus();
    refocusUserId.current = null;
  }, [pendingRole]);

  useEffect(() => {
    if (leftProject !== null) heading.current?.focus();
  }, [leftProject]);

  const orgRole = organization?.role;
  const canManage =
    orgRole === "owner" || orgRole === "admin" || project?.myRole === "admin";
  const canManageOrganization = orgRole === "owner" || orgRole === "admin";

  const refresh = () =>
    queryClient
      .invalidateQueries(
        { queryKey: projectQueryKeys.all(organizationId) },
        { throwOnError: true },
      )
      .then(
        () => true,
        () => false,
      );

  // A 403 or 404 may mean the role or the Project changed, so the context
  // reloads before the Project queries.
  const reload = () => {
    void refreshMembershipContext().finally(() => {
      void queryClient.invalidateQueries(
        { queryKey: projectQueryKeys.all(organizationId) },
        { cancelRefetch: false },
      );
    });
  };

  const handleStale = (reason: AddStaleReason) => {
    setAdding(null);
    if (reason === "denied") {
      setNotice({ text: ROLE_CHANGED, kind: "role-changed" });
    }
    reload();
  };

  // Shared by role change and removal: the reason text, and a refetch whenever
  // the page may be showing something the server no longer agrees with.
  const failureMessage = (error: unknown, kind: "change" | "remove") => {
    if (error instanceof ApiError) {
      if (error.code === "LAST_PROJECT_ADMIN") {
        void refresh();
        return kind === "change"
          ? LAST_ADMIN_CHANGE_MESSAGE
          : LAST_ADMIN_REMOVE_MESSAGE;
      }
      if (error.code === "PROJECT_MEMBER_NOT_FOUND") {
        void refresh();
        return MEMBER_GONE_MESSAGE;
      }
      if (
        error.code === "PERMISSION_DENIED" ||
        error.code === "MEMBERSHIP_DENIED" ||
        error.code === "PROJECT_NOT_FOUND"
      ) {
        reload();
      }
    }
    return kind === "change" ? ROLE_FAILED_MESSAGE : REMOVE_FAILED_MESSAGE;
  };

  const changeRole = async (member: ProjectMember, role: ProjectRole) => {
    if (pendingRole !== null || role === member.projectRole) return;
    setProblem(null);
    setNotice(null);
    setPendingRole({ userId: member.userId, role });
    try {
      await updateProjectMemberRole(
        organizationId,
        projectId,
        member.userId,
        role,
      );
      await refresh();
    } catch (error) {
      setProblem(failureMessage(error, "change"));
    } finally {
      refocusUserId.current = member.userId;
      setPendingRole(null);
    }
  };

  const confirmRemove = async () => {
    if (removal === null || removal.pending) return;
    const { member } = removal;
    setRemoval({ ...removal, pending: true, error: null });
    try {
      await removeProjectMember(organizationId, projectId, member.userId);
    } catch (error) {
      const message = failureMessage(error, "remove");
      if (error instanceof ApiError) {
        if (error.code === "PROJECT_MEMBER_NOT_FOUND") {
          // Someone else removed them first; the refetch already runs.
          setRemoval(null);
          setNotice({ text: message, kind: "stale" });
          return;
        }
        if (
          error.code === "PERMISSION_DENIED" ||
          error.code === "MEMBERSHIP_DENIED" ||
          error.code === "PROJECT_NOT_FOUND"
        ) {
          setRemoval(null);
          return;
        }
      }
      setRemoval({ ...removal, pending: false, error: message });
      return;
    }
    if (member.userId === me?.user.id && !canManageOrganization) {
      // Access ends with the membership: the refetch will answer 404.
      setLeftProject(project?.name ?? "");
      setRemoval(null);
      void refresh();
      return;
    }
    const reloaded = await refresh();
    setNotice(
      reloaded
        ? { text: `นำ ${member.name} ออกจากโปรเจกต์แล้ว`, kind: "saved" }
        : null,
    );
    setRemoval(null);
  };

  const header = (
    options: { actions?: ReactNode; status?: ReactNode; title?: string } = {},
  ) => (
    <>
      <PageHeader
        eyebrow="// MEMBERS"
        scope={
          project === undefined
            ? undefined
            : { mark: project.name, label: project.name, tag: "โปรเจกต์" }
        }
        title={options.title ?? "สมาชิกโปรเจกต์"}
        status={options.status}
        actions={options.actions}
        titleRef={heading}
        titleTabIndex={-1}
      />
      {notice === null ? null : notice.kind === "stale" ? (
        <Alert
          data-testid="project-members-notice-stale"
          tone="info"
          role="status"
        >
          {notice.text}
        </Alert>
      ) : notice.kind === "role-changed" ? (
        <Alert
          data-testid="project-members-notice-role-changed"
          tone="info"
          role="status"
        >
          {notice.text}
        </Alert>
      ) : (
        <Notice data-testid="project-members-notice-saved" tone="success">
          {notice.text}
        </Notice>
      )}
    </>
  );
  const backLink = (
    <Button asChild variant="secondary">
      <Link
        data-testid="project-members-back"
        to={`/organizations/${organizationId}/projects`}
      >
        กลับไปรายการโปรเจกต์
      </Link>
    </Button>
  );

  if (switchedOrganization) {
    // Nothing of the old Organization stays on screen while the redirect lands.
    return (
      <Page>
        <PageHeader
          eyebrow="// MEMBERS"
          title="สมาชิกโปรเจกต์"
          titleRef={heading}
          titleTabIndex={-1}
        />
        <PageState
          data-testid="project-members-loading"
          kind="loading"
          label="กำลังโหลดสมาชิกโปรเจกต์"
          layout="table"
        />
      </Page>
    );
  }
  if (mePending || contextRefresh === "refreshing") {
    return (
      <Page>
        {header()}
        <PageState
          data-testid="project-members-loading"
          statusTestId="project-members-loading-status"
          kind="loading"
          label="กำลังโหลดสมาชิกโปรเจกต์"
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
          data-testid="project-members-context-error"
          alertTestId="project-members-context-alert"
          kind="error"
          message="ไม่สามารถยืนยันสิทธิ์ดูโปรเจกต์ได้"
          retryLabel="ลองอีกครั้ง"
          onRetry={() => void refreshMembershipContext()}
        />
      </Page>
    );
  }
  if (organization === undefined || denied) {
    // No project or organization name: a non-member learns nothing.
    return (
      <Page>
        <PageHeader
          eyebrow="// MEMBERS"
          title="สมาชิกโปรเจกต์"
          titleRef={heading}
          titleTabIndex={-1}
        />
        <PageState
          data-testid="project-members-denied"
          alertTestId="project-members-denied-alert"
          kind="denied"
          message="คุณไม่มีสิทธิ์ดูโปรเจกต์ขององค์กรนี้"
        />
      </Page>
    );
  }
  if (leftProject !== null) {
    return (
      <Page>
        <PageHeader
          eyebrow="// MEMBERS"
          title="สมาชิกโปรเจกต์"
          titleRef={heading}
          titleTabIndex={-1}
        />
        <PageState
          data-testid="project-members-left"
          kind="denied"
          tone="info"
          message={`คุณออกจากโปรเจกต์ ${leftProject} แล้ว`}
          action={backLink}
        />
      </Page>
    );
  }
  if (notFound) {
    // Same state for a missing Project and one the user cannot see (AC-08).
    return (
      <Page>
        <PageHeader
          eyebrow="// MEMBERS"
          title="สมาชิกโปรเจกต์"
          titleRef={heading}
          titleTabIndex={-1}
        />
        <PageState
          data-testid="project-members-not-found"
          kind="denied"
          tone="info"
          message="ไม่พบโปรเจกต์นี้"
          action={backLink}
        />
      </Page>
    );
  }
  if (project === undefined || members === undefined) {
    return (
      <Page>
        {header()}
        {detail.isError || membersQuery.isError ? (
          <PageState
            data-testid="project-members-error"
            alertTestId="project-members-error-alert"
            retryTestId="project-members-retry"
            kind="error"
            message="โหลดสมาชิกโปรเจกต์ไม่สำเร็จ"
            retryLabel="ลองอีกครั้ง"
            onRetry={() => {
              void detail.refetch();
              void membersQuery.refetch();
            }}
          />
        ) : (
          <PageState
            data-testid="project-members-loading"
            statusTestId="project-members-loading-status"
            kind="loading"
            label="กำลังโหลดสมาชิกโปรเจกต์"
            layout="table"
          />
        )}
      </Page>
    );
  }

  const needle = search.trim().toLowerCase();
  const visible = members.filter(
    (member) =>
      needle === "" ||
      member.name.toLowerCase().includes(needle) ||
      member.email.toLowerCase().includes(needle),
  );
  const orgRoleLabel = ROLE_LABELS[orgRole ?? ""] ?? orgRole;

  const columns: DataTableColumn<ProjectMember>[] = [
    {
      key: "member",
      header: "สมาชิก",
      cell: (member) => (
        <span className="flex min-w-48 items-center gap-3">
          <span
            aria-hidden="true"
            className="surface-hover inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground/20 text-xs font-semibold"
          >
            {initialsOf(member.name)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-medium break-words">
              <span data-testid="project-member-name">{member.name}</span>
              {member.userId === me?.user.id ? (
                <span
                  data-testid="project-member-self"
                  className="ml-1 font-normal text-foreground-secondary"
                >
                  (คุณ)
                </span>
              ) : null}
            </span>
            <span
              data-testid="project-member-email"
              className="text-[13px] break-all text-foreground-secondary"
            >
              {member.email}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "organizationRole",
      header: "บทบาทในองค์กร",
      width: "160px",
      cell: (member) => (
        <span
          data-testid="project-member-organization-role"
          data-organization-role={member.organizationRole}
        >
          {ROLE_LABELS[member.organizationRole] ?? member.organizationRole}
        </span>
      ),
    },
    {
      key: "projectRole",
      header: "บทบาทในโปรเจกต์",
      width: "200px",
      cell: (member) => {
        if (!canManage) {
          return (
            <span
              data-testid="project-member-role"
              data-project-role={member.projectRole}
            >
              {PROJECT_ROLE_LABELS[member.projectRole]}
            </span>
          );
        }
        const shown =
          pendingRole?.userId === member.userId
            ? pendingRole.role
            : member.projectRole;
        return (
          <select
            data-testid="project-member-role-select"
            data-user-id={member.userId}
            aria-label={`บทบาทในโปรเจกต์ของ ${member.name}`}
            aria-describedby={
              problem === null ? undefined : "project-members-problem"
            }
            className={`${textInputClass} h-9 text-sm`}
            value={shown}
            disabled={pendingRole !== null}
            aria-busy={pendingRole?.userId === member.userId ? true : undefined}
            onChange={(event) => {
              const role = ROLES.find((item) => item === event.target.value);
              if (role !== undefined) void changeRole(member, role);
            }}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {PROJECT_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: "joinedAt",
      header: "เข้าร่วมเมื่อ",
      width: "140px",
      mono: true,
      cell: (member) => (
        <time
          data-testid="project-member-joined-at"
          dateTime={member.joinedAt}
          className="text-foreground-secondary"
        >
          {formatAuditDate(new Date(member.joinedAt), preferences)}
        </time>
      ),
    },
  ];

  const status = (
    <span>
      <span data-testid="project-slug" className="font-mono">
        {project.slug}
      </span>{" "}
      · สมาชิก{" "}
      <span data-testid="project-member-count" className="font-mono">
        {project.memberCount}
      </span>{" "}
      คน · ผู้ดูแล{" "}
      <span data-testid="project-admin-count" className="font-mono">
        {project.adminCount}
      </span>{" "}
      คน ·{" "}
      <span
        data-testid="project-my-role"
        data-project-role={project.myRole ?? "none"}
      >
        {project.myRole === null
          ? `คุณไม่ได้เป็นสมาชิก เข้าถึงในฐานะ${orgRoleLabel ?? ""}ขององค์กร`
          : `บทบาทของคุณ: ${PROJECT_ROLE_LABELS[project.myRole]}`}
      </span>
    </span>
  );
  const actions = (
    <>
      {backLink}
      {canManage ? (
        <Button
          data-testid="project-members-add"
          type="button"
          onClick={(event) => {
            setNotice(null);
            setProblem(null);
            setAdding({ opener: event.currentTarget });
          }}
        >
          เพิ่มสมาชิก
        </Button>
      ) : null}
    </>
  );

  return (
    <Page>
      {header({ actions, status })}
      {detail.isError || membersQuery.isError ? (
        <Alert data-testid="project-members-stale-warning" tone="warning">
          อัปเดตรายการไม่สำเร็จ กำลังแสดงรายการที่โหลดไว้ก่อนหน้า
        </Alert>
      ) : null}
      {problem === null ? null : (
        <Alert
          data-testid="project-members-problem"
          id="project-members-problem"
          tone="error"
        >
          {problem}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <section
          aria-labelledby="project-members-heading"
          className="flex min-w-0 flex-col gap-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id="project-members-heading"
              className="text-base font-semibold text-heading"
            >
              รายชื่อสมาชิก
            </h2>
            <Label className="relative block w-72 max-w-full">
              <span className="sr-only">ค้นหาสมาชิกโปรเจกต์</span>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-foreground-secondary"
              >
                <SearchIcon size={18} />
              </span>
              <Input
                data-testid="project-members-search"
                type="search"
                value={search}
                maxLength={200}
                className="pl-10"
                placeholder="ค้นหาชื่อหรืออีเมล"
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </Label>
          </div>
          <DataTable
            data-testid="project-members-table"
            rowTestId={(member) => `project-member-row-${member.userId}`}
            ariaLabel="รายชื่อสมาชิกโปรเจกต์"
            columns={columns}
            rows={visible}
            rowKey={(member) => member.userId}
            empty={
              <span data-testid="project-members-no-results">
                ไม่พบสมาชิกที่ตรงกับ “{search.trim()}”
              </span>
            }
            rowActions={
              canManage
                ? (member) => (
                    <Button
                      data-testid="project-member-remove"
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`นำ ${member.name} ออก`}
                      onClick={(event) => {
                        setNotice(null);
                        setProblem(null);
                        setRemoval({
                          member,
                          opener: event.currentTarget,
                          pending: false,
                          error: null,
                        });
                      }}
                    >
                      นำออก
                    </Button>
                  )
                : undefined
            }
          />
          <p
            data-testid="project-members-shown"
            className="text-xs text-foreground-secondary"
          >
            แสดง {visible.length} จาก {members.length}
          </p>
        </section>
        <Card
          as="section"
          padding="md"
          aria-labelledby="project-roles-heading"
          data-testid="project-roles-panel"
        >
          <h2
            id="project-roles-heading"
            className="text-base font-semibold text-heading"
          >
            บทบาทในโปรเจกต์
          </h2>
          <dl className="flex flex-col gap-3 text-sm">
            {ROLES.map((role) => (
              <div key={role} data-testid={`project-role-description-${role}`}>
                <dt className="font-medium">{PROJECT_ROLE_LABELS[role]}</dt>
                <dd className="text-foreground-secondary">
                  {PROJECT_ROLE_DESCRIPTIONS[role]}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-2 border-t border-foreground/10 pt-4 text-sm text-foreground-secondary">
            <p data-testid="project-rule-last-admin">
              ต้องมีผู้ดูแลอย่างน้อย 1 คน
              ระบบไม่ให้เปลี่ยนบทบาทหรือนำผู้ดูแลคนสุดท้ายออก
            </p>
            <p data-testid="project-rule-organization-only">
              เพิ่มได้เฉพาะคนที่เป็นสมาชิกขององค์กร {organization.name} อยู่แล้ว{" "}
              {canManageOrganization ? (
                <Link
                  data-testid="project-members-organization-link"
                  className="text-primary underline-offset-4 hover:underline"
                  to={`/organizations/${organizationId}/members`}
                >
                  จัดการสมาชิกองค์กร
                </Link>
              ) : null}
            </p>
          </div>
        </Card>
      </div>
      {adding === null ? null : (
        <AddMemberDialog
          organizationId={organizationId}
          organizationName={organization.name}
          projectId={projectId}
          projectName={project.name}
          opener={adding.opener}
          fallbackFocus={heading}
          onAdded={async ({ added, already, role }) => {
            const reloaded = await refresh();
            // Only people this request added count; the rest were in already.
            const text =
              added === 0
                ? "คนที่เลือกอยู่ในโปรเจกต์อยู่แล้ว ไม่มีใครถูกเพิ่ม"
                : `เพิ่ม ${String(added)} คนเป็น${PROJECT_ROLE_LABELS[role]}แล้ว${
                    already === 0
                      ? ""
                      : ` · ${String(already)} คนอยู่ในโปรเจกต์อยู่แล้ว`
                  }`;
            setNotice(
              reloaded ? { text, kind: added === 0 ? "stale" : "saved" } : null,
            );
            setAdding(null);
          }}
          onCancel={() => {
            setAdding(null);
          }}
          onStale={handleStale}
        />
      )}
      {removal === null ? null : (
        <ConfirmDialog
          data-testid="project-member-remove-dialog"
          confirmTestId="project-member-remove-confirm"
          title={`นำ ${removal.member.name} ออกจากโปรเจกต์ ${project.name}`}
          description={
            <>
              <p>
                สมาชิกจะเข้าโปรเจกต์นี้ไม่ได้อีก
                แต่ยังอยู่ในองค์กรและเพิ่มกลับได้ภายหลัง
              </p>
              {removal.error === null ? null : (
                <p
                  data-testid="project-member-remove-error"
                  role="alert"
                  className="mt-2 text-danger"
                >
                  {removal.error}
                </p>
              )}
            </>
          }
          confirmLabel="นำออก"
          confirmVariant="destructive"
          pendingLabel="กำลังนำออก…"
          pending={removal.pending}
          opener={removal.opener}
          fallbackFocus={heading}
          onCancel={() => {
            setRemoval(null);
          }}
          onConfirm={() => void confirmRemove()}
        />
      )}
    </Page>
  );
}
