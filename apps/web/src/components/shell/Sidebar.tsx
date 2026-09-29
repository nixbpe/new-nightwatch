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
  type NavLeaf,
} from "./nav-config";
import { OrgSwitcher } from "./OrgSwitcher";

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
        className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2"
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
              // Matched on the resolved href, so an org leaf is current only for the org it links to.
              active={isLeafActive({ path: href }, pathname)}
              onNavigate={onNavigate}
            />
          ));
          if (!isNavGroup(item)) {
            return navRows;
          }
          return (
            <div key={item.label} className="flex flex-col gap-1">
              {collapsed ? (
                <div
                  role="separator"
                  aria-label={item.label}
                  className="my-2 h-px bg-foreground/10"
                />
              ) : (
                <p className="mt-6 mb-2 px-3 text-xs font-medium text-foreground-secondary">
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
  active,
  onNavigate,
}: {
  leaf: NavLeaf;
  href: string;
  collapsed: boolean;
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
            ? "bg-foreground/8 text-primary before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"
            : "text-foreground-secondary hover:bg-foreground/5 hover:text-foreground"
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
      className={`relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-100 ${
        active
          ? "bg-foreground/8 font-medium text-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"
          : "text-foreground-secondary hover:bg-foreground/5 hover:text-foreground"
      }`}
    >
      <span className={active ? "text-primary" : ""}>
        <Icon />
      </span>
      <span>{leaf.label}</span>
    </NavLink>
  );
}
