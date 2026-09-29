import type { RefObject } from "react";
import { Link, useLocation } from "react-router";

import { useTenant } from "../../lib/tenant/TenantProvider";
import { getBreadcrumbTrail } from "./breadcrumb";
import { ChevronRightIcon, MenuIcon, PanelLeftIcon, SearchIcon } from "./icons";
import { Kbd } from "./Kbd";
import { getRouteOrganizationId } from "./nav-config";
import { NotificationsPopover } from "./NotificationsPopover";

export function Header({
  collapsed,
  onToggleSidebar,
  onOpenMobileMenu,
  mobileMenuButtonRef,
  onOpenSearch,
}: {
  collapsed: boolean;
  onToggleSidebar: () => void;
  onOpenMobileMenu: () => void;
  mobileMenuButtonRef: RefObject<HTMLButtonElement | null>;
  onOpenSearch: () => void;
}) {
  const { pathname } = useLocation();
  const { activeOrg, me } = useTenant();

  const pageTrail = getBreadcrumbTrail(pathname);
  // Root crumb is the org the page acts on (a bookmarked URL may name a non-active org); an id
  // outside the user's memberships is shown as-is and the page reports the denial.
  const routeOrgId = getRouteOrganizationId(pathname);
  const rootCrumb =
    routeOrgId === null
      ? activeOrg === null
        ? null
        : { label: activeOrg.name, path: "/workspace" }
      : {
          label:
            me?.organizations.find((org) => org.id === routeOrgId)?.name ??
            routeOrgId,
          // Link only for the active org; /workspace would otherwise open another tenant's page.
          ...(routeOrgId === activeOrg?.id ? { path: "/workspace" } : {}),
        };
  const trail = rootCrumb === null ? pageTrail : [rootCrumb, ...pageTrail];

  const iconButton =
    "inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground-secondary hover:bg-foreground/5 hover:text-foreground";

  return (
    <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-foreground/10 bg-background px-3 sm:px-4">
      <button
        ref={mobileMenuButtonRef}
        type="button"
        aria-label="เปิดเมนู"
        onClick={onOpenMobileMenu}
        className={`${iconButton} sm:hidden`}
      >
        <MenuIcon />
      </button>
      <button
        type="button"
        aria-label={collapsed ? "ขยายเมนู" : "ย่อเมนู"}
        aria-expanded={!collapsed}
        aria-controls="app-sidebar"
        onClick={onToggleSidebar}
        className={`${iconButton} hidden sm:inline-flex`}
      >
        <PanelLeftIcon size={18} />
      </button>

      <nav aria-label="ตำแหน่งปัจจุบัน" className="min-w-0 flex-1 ps-1">
        <ol className="flex items-center gap-2 text-sm">
          {trail.map((crumb, index) => {
            const isLast = index === trail.length - 1;
            return (
              <li
                key={`${crumb.label}-${String(index)}`}
                className={`flex items-center gap-2 ${
                  isLast ? "min-w-0" : "hidden lg:flex"
                }`}
              >
                {index > 0 ? (
                  <span
                    aria-hidden="true"
                    className="hidden text-foreground-secondary lg:block"
                  >
                    <ChevronRightIcon size={14} />
                  </span>
                ) : null}
                {crumb.path !== undefined && !isLast ? (
                  <Link
                    to={crumb.path}
                    className="text-foreground-secondary hover:text-foreground"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className={
                      isLast
                        ? "truncate font-medium text-foreground"
                        : "truncate text-foreground-secondary"
                    }
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={onOpenSearch}
          // Field-shaped, so it uses the control-border token (>= 3:1 contrast), not the divider hairline.
          className="hidden h-9 w-80 items-center gap-2 rounded-md border border-control-border bg-surface px-3 text-sm text-foreground-secondary hover:bg-foreground/5 hover:text-foreground lg:flex"
        >
          <SearchIcon size={16} />
          <span className="flex-1 text-start">ค้นหาทั้งหมด...</span>
          <Kbd>⌘K</Kbd>
        </button>
        <button
          type="button"
          aria-label="ค้นหาทั้งหมด"
          onClick={onOpenSearch}
          className={`${iconButton} lg:hidden`}
        >
          <SearchIcon size={18} />
        </button>
        <NotificationsPopover />
      </div>
    </header>
  );
}
