import { NavLink, useLocation } from "react-router";

import { useTenant } from "../../lib/tenant/TenantProvider";
import { AccountMenu } from "./AccountMenu";
import { NAV_ICONS } from "./icons";
import {
  canSeeLeaf,
  isLeafActive,
  isNavGroup,
  NAV_ITEMS,
  resolveNavPath,
  type NavCountSource,
  type NavLeaf,
} from "./nav-config";
import { OrgSwitcher } from "./OrgSwitcher";
import { useMonitorTotal, useUnreadCount } from "./useNavCounts";

export function Sidebar({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const { activeOrg } = useTenant();
  const organizationId = activeOrg?.id ?? null;
  const role = activeOrg?.role ?? null;
  const unread = useUnreadCount();
  const monitorTotal = useMonitorTotal(organizationId);
  // Unknown or failed counts render nothing, never a guessed number (CMP-01).
  const counts: Record<NavCountSource, number | undefined> = {
    monitors: monitorTotal,
    unread:
      unread.isError || unread.data?.unreadCount === 0
        ? undefined
        : unread.data?.unreadCount,
  };

  const visibleRows = (leaves: NavLeaf[]) =>
    leaves.flatMap((leaf) => {
      const href = resolveNavPath(leaf.path, organizationId);
      return href !== null && canSeeLeaf(leaf, role) ? [{ leaf, href }] : [];
    });

  return (
    <div className="flex h-full flex-col">
      <OrgSwitcher collapsed={collapsed} />
      <nav
        aria-label="เมนูหลัก"
        className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-4"
      >
        {NAV_ITEMS.map((item) => {
          const rows = visibleRows(isNavGroup(item) ? item.children : [item]);
          if (rows.length === 0) {
            return null;
          }
          const navRows = rows.map(({ leaf, href }) => (
            <NavRow
              key={leaf.path}
              leaf={leaf}
              href={href}
              collapsed={collapsed}
              count={leaf.count === undefined ? undefined : counts[leaf.count]}
              // Matched on the resolved href, so an org leaf is current only for the org it links to.
              active={isLeafActive({ path: href }, pathname)}
              onNavigate={onNavigate}
            />
          ));
          if (!isNavGroup(item)) {
            return navRows;
          }
          return (
            <div key={item.label} className="flex flex-col gap-0.5">
              {collapsed ? (
                <div
                  role="separator"
                  aria-label={item.label}
                  className="my-2 h-px bg-foreground/10"
                />
              ) : (
                <p className="mt-4 mb-1.5 px-2.5 text-xs font-medium text-foreground-secondary">
                  {item.label}
                </p>
              )}
              {navRows}
            </div>
          );
        })}
      </nav>
      <AccountMenu collapsed={collapsed} />
    </div>
  );
}

function NavRow({
  leaf,
  href,
  collapsed,
  count,
  active,
  onNavigate,
}: {
  leaf: NavLeaf;
  href: string;
  collapsed: boolean;
  count?: number;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = NAV_ICONS[leaf.icon];
  if (collapsed) {
    return (
      <NavLink
        to={href}
        title={leaf.label}
        aria-label={leaf.label}
        onClick={onNavigate}
        className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-100 ${
          active
            ? "bg-primary-tint text-primary before:absolute before:inset-y-1.5 before:-left-2 before:w-[3px] before:bg-primary"
            : "text-foreground-secondary hover:surface-hover hover:text-foreground"
        }`}
      >
        <Icon />
      </NavLink>
    );
  }
  return (
    <NavLink
      to={href}
      onClick={onNavigate}
      // The 3 px bar sits on the sidebar edge (-8 px past the row's 8 px inset).
      className={`relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-100 ${
        active
          ? "bg-primary-tint font-medium text-primary before:absolute before:inset-y-1.5 before:-left-2 before:w-[3px] before:bg-primary"
          : "text-foreground-secondary hover:surface-hover hover:text-foreground"
      }`}
    >
      <span className={active ? "text-primary" : ""}>
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate">{leaf.label}</span>
      {count === undefined ? null : (
        // aria-hidden keeps the link's accessible name equal to its label.
        <span
          aria-hidden="true"
          data-slot="nav-count"
          className="font-mono text-xs font-medium text-foreground-secondary tabular-nums"
        >
          {count}
        </span>
      )}
    </NavLink>
  );
}
