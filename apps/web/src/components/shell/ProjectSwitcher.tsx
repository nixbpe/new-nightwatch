import type { ProjectSummary } from "@nightwatch/api-contract";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { PROJECT_ROLE_LABELS } from "../../pages/projects/members/roles";
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "./icons";
import { initialsFontClass, initialsOf } from "./initials";
import { CREATE_PROJECT_PARAM, projectSwitchDestination } from "./nav-config";
import { Skeleton } from "./Skeleton";
import { useCurrentProject } from "./useCurrentProject";
import { usePopover } from "./usePopover";

// Sits above the scrolling nav, not inside it, so its menu is not clipped by the nav's overflow.
export function ProjectSwitcher({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const current = useCurrentProject();
  const location = useLocation();
  const navigate = useNavigate();
  const popover = usePopover();
  const [query, setQuery] = useState("");
  const menuId = useId();

  useEffect(() => {
    if (!popover.open) setQuery("");
  }, [popover.open]);

  // A route change re-admits the organization, which replaces this button, so focus follows the switch back to
  // it. The request is dropped on the first other path, so a redirect cannot leave it to steal focus later.
  const refocus = useRef<{ from: string; to: string } | null>(null);
  useEffect(() => {
    const pending = refocus.current;
    if (pending === null) return;
    if (location.pathname === pending.to) {
      if (popover.triggerRef.current === null) return;
      refocus.current = null;
      popover.triggerRef.current.focus();
    } else if (location.pathname !== pending.from) {
      refocus.current = null;
    }
  });

  if (current.organizationId === null) return null;
  const organizationId = current.organizationId;
  const canManage = current.role === "owner" || current.role === "admin";
  const projectsPath = `/organizations/${organizationId}/projects`;
  const blockClass = `flex h-10 w-full items-center gap-2.5 rounded-md ${
    collapsed ? "justify-center" : "px-2"
  }`;
  const frame = (children: ReactNode) => (
    <div className="relative border-b border-foreground/10 px-2 py-2">
      {collapsed ? null : (
        <p className="px-2 pb-1 text-xs font-medium text-foreground-secondary">
          โปรเจกต์
        </p>
      )}
      {children}
    </div>
  );

  if (current.status === "loading") {
    return frame(
      <div className={blockClass}>
        <Skeleton className="h-8 w-8 flex-shrink-0" />
        {collapsed ? null : <Skeleton className="h-3 w-24" />}
      </div>,
    );
  }
  if (current.status === "error") {
    return frame(
      <button
        type="button"
        data-testid="shell-project-retry"
        aria-label="โหลดโปรเจกต์ไม่สำเร็จ ลองอีกครั้ง"
        title="โหลดโปรเจกต์ไม่สำเร็จ ลองอีกครั้ง"
        onClick={current.refetch}
        className={`${blockClass} text-sm text-foreground-secondary hover:surface-hover`}
      >
        <ProjectMark name="?" muted />
        {collapsed ? null : <span>โหลดโปรเจกต์ไม่สำเร็จ ลองอีกครั้ง</span>}
      </button>,
    );
  }
  const projects = current.projects ?? [];
  if (projects.length === 0) {
    return frame(
      <Link
        data-testid="shell-project-empty"
        to={projectsPath}
        onClick={onNavigate}
        aria-label={
          collapsed ? "ยังไม่มีโปรเจกต์ ไปที่โปรเจกต์ทั้งหมด" : undefined
        }
        title={collapsed ? "ยังไม่มีโปรเจกต์" : undefined}
        className={`${blockClass} hover:surface-hover`}
      >
        <ProjectMark name="+" muted />
        {collapsed ? null : (
          <span className="min-w-0 flex-1 text-start">
            <span className="block truncate text-sm font-semibold text-foreground">
              ยังไม่มีโปรเจกต์
            </span>
            <span className="block truncate text-xs text-foreground-secondary">
              ไปที่โปรเจกต์ทั้งหมด
            </span>
          </span>
        )}
      </Link>,
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = projects.filter(
    (project) =>
      needle === "" ||
      project.name.toLowerCase().includes(needle) ||
      project.slug.toLowerCase().includes(needle),
  );
  const joined = visible.filter((project) => project.myRole !== null);
  // The server lists Projects without membership only to Owners and Admins; the role is checked here too.
  const notJoined = canManage
    ? visible.filter((project) => project.myRole === null)
    : [];

  const choose = (project: ProjectSummary) => {
    popover.close();
    if (project.id === current.projectId) return;
    onNavigate?.();
    const destination = projectSwitchDestination(
      location.pathname,
      organizationId,
      project.id,
    );
    if (destination !== null) {
      refocus.current = { from: location.pathname, to: destination };
      void navigate(destination);
    }
  };

  const option = (project: ProjectSummary) => {
    const checked = project.id === current.projectId;
    return (
      <button
        key={project.id}
        data-testid={`shell-project-option-${project.id}`}
        type="button"
        role="menuitemradio"
        aria-checked={checked}
        onClick={() => {
          choose(project);
        }}
        className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm hover:bg-foreground/5 ${
          checked ? "bg-primary-tint" : ""
        }`}
      >
        <ProjectMark name={project.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">
            {project.name}
          </span>
          <span className="block truncate text-xs text-foreground-secondary">
            <span className="font-mono">{project.slug}</span>
            <span className="ps-2">
              {project.myRole === null
                ? "ไม่ได้เข้าร่วม"
                : PROJECT_ROLE_LABELS[project.myRole]}
            </span>
          </span>
        </span>
        {checked ? (
          <span className="text-primary">
            <CheckIcon size={16} />
          </span>
        ) : null}
      </button>
    );
  };

  const group = (id: string, label: string, items: ProjectSummary[]) =>
    items.length === 0 ? null : (
      <div role="group" aria-labelledby={`${menuId}-${id}`}>
        <p
          id={`${menuId}-${id}`}
          className="px-2.5 py-1.5 text-xs text-foreground-secondary"
        >
          {label}
        </p>
        {items.map(option)}
      </div>
    );

  const linkClass =
    "flex w-full flex-shrink-0 items-center rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-foreground/5";
  const label = current.project?.name ?? "เลือกโปรเจกต์";

  return frame(
    <>
      <button
        ref={popover.triggerRef}
        data-testid="shell-project-switch"
        type="button"
        aria-haspopup="menu"
        aria-expanded={popover.open}
        aria-label={collapsed ? `โปรเจกต์: ${label}` : undefined}
        onClick={popover.toggle}
        className={`${blockClass} hover:surface-hover`}
      >
        <ProjectMark
          name={current.project?.name ?? "?"}
          muted={current.project === null}
        />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 text-start">
              <span
                data-testid="shell-project-name"
                className="block truncate text-sm font-semibold text-foreground"
              >
                {label}
              </span>
              <span className="block truncate text-xs text-foreground-secondary">
                {current.project === null ? (
                  "สลับโปรเจกต์"
                ) : (
                  <>
                    <span className="font-mono">{current.project.slug}</span>
                    {current.project.myRole === null ? null : (
                      <span className="ps-2">
                        {PROJECT_ROLE_LABELS[current.project.myRole]}
                      </span>
                    )}
                  </>
                )}
              </span>
            </span>
            <span className="text-foreground-secondary">
              <ChevronsUpDownIcon size={16} />
            </span>
          </>
        )}
      </button>
      {popover.open ? (
        <div
          ref={popover.panelRef}
          data-testid="shell-project-menu-panel"
          tabIndex={-1}
          className="overlay-enter absolute top-full left-2 z-50 mt-1 flex max-h-[calc(100dvh-9rem)] w-64 flex-col rounded-md border border-foreground/10 bg-surface p-1 shadow-lg focus:outline-none"
        >
          <div className="relative flex-shrink-0 p-1">
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-foreground-secondary">
              <SearchIcon size={14} />
            </span>
            <input
              data-testid="shell-project-search"
              data-popover-item
              type="text"
              aria-label="ค้นหาโปรเจกต์"
              autoComplete="off"
              spellCheck={false}
              placeholder="ค้นหาโปรเจกต์"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              className="h-8 w-full rounded-md border border-control-border bg-surface ps-8 pe-2 text-sm text-foreground outline-none placeholder:text-foreground-secondary focus-visible:border-primary"
            />
          </div>
          <div
            data-testid="shell-project-menu"
            role="menu"
            aria-label="สลับโปรเจกต์"
            className="flex min-h-0 flex-col"
          >
            {/* Only the Project list scrolls; the search field and the links below stay in view. */}
            <div
              role="none"
              data-testid="shell-project-list"
              className="min-h-0 overflow-y-auto overscroll-contain"
            >
              {group("joined", "โปรเจกต์ที่เข้าร่วม", joined)}
              {group("other", "ไม่ได้เข้าร่วม", notJoined)}
              {joined.length === 0 && notJoined.length === 0 ? (
                <p
                  role="none"
                  className="px-2.5 py-3 text-sm text-foreground-secondary"
                >
                  ไม่พบโปรเจกต์
                </p>
              ) : null}
            </div>
            <div
              role="separator"
              className="my-1 h-px flex-shrink-0 bg-foreground/10"
            />
            <Link
              data-testid="shell-project-all"
              role="menuitem"
              to={projectsPath}
              onClick={() => {
                popover.close();
                onNavigate?.();
              }}
              className={linkClass}
            >
              โปรเจกต์ทั้งหมด
            </Link>
            {canManage ? (
              <Link
                data-testid="shell-project-create"
                role="menuitem"
                to={`${projectsPath}?${CREATE_PROJECT_PARAM}=1`}
                onClick={() => {
                  popover.close();
                  onNavigate?.();
                }}
                className={linkClass}
              >
                สร้างโปรเจกต์
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </>,
  );
}

/** A system object like the organization mark: 4 px corner, solid Primary with On primary initials. */
function ProjectMark({
  name,
  muted = false,
}: {
  name: string;
  muted?: boolean;
}) {
  const initials = initialsOf(name);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
        muted
          ? "border border-control-border text-foreground-secondary"
          : "bg-primary text-on-primary"
      } ${initialsFontClass(initials)}`}
    >
      {initials}
    </span>
  );
}
