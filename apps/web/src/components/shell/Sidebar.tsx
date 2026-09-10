import { NavLink, useLocation } from "react-router";

import { AccountMenu } from "./AccountMenu";
import { NAV_ICONS } from "./icons";
import {
  isLeafActive,
  isNavGroup,
  NAV_ITEMS,
  type NavLeaf,
} from "./nav-config";
import { OrgSwitcher } from "./OrgSwitcher";

/**
 * Left menubar, per the reference: org switcher on top, the config-driven
 * menu (nav-config.ts) with labelled sections in the middle, the account
 * menu pinned to the bottom. `collapsed` is the icon rail (default below
 * `lg`, or by the header toggle); the same component fills the mobile
 * drawer, where `onNavigate` closes it after a choice.
 */
export function Sidebar({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  return (
    <div className="flex h-full flex-col">
      <OrgSwitcher collapsed={collapsed} />
      <nav
        aria-label="เมนูหลัก"
        className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2"
      >
        {NAV_ITEMS.map((item) =>
          isNavGroup(item) ? (
            <div key={item.label} className="flex flex-col gap-1">
              {collapsed ? (
                <div
                  role="separator"
                  aria-label={item.label}
                  className="my-2 h-px bg-foreground/10"
                />
              ) : (
                <p className="mt-4 mb-1 px-3 text-xs text-foreground-secondary">
                  {item.label}
                </p>
              )}
              {item.children.map((leaf) => (
                <NavRow
                  key={leaf.path}
                  leaf={leaf}
                  collapsed={collapsed}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ) : (
            <NavRow
              key={item.path}
              leaf={item}
              collapsed={collapsed}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ),
        )}
      </nav>
      <AccountMenu collapsed={collapsed} />
    </div>
  );
}

function NavRow({
  leaf,
  collapsed,
  pathname,
  onNavigate,
}: {
  leaf: NavLeaf;
  collapsed: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = NAV_ICONS[leaf.icon];
  const active = isLeafActive(leaf, pathname);
  if (collapsed) {
    return (
      <NavLink
        to={leaf.path}
        title={leaf.label}
        aria-label={leaf.label}
        onClick={onNavigate}
        className={`mx-auto flex h-9 w-9 items-center justify-center rounded-md ${
          active
            ? "bg-foreground/8 text-primary"
            : "text-foreground-secondary hover:bg-foreground/5 hover:text-foreground"
        }`}
      >
        <Icon />
      </NavLink>
    );
  }
  return (
    <NavLink
      to={leaf.path}
      onClick={onNavigate}
      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${
        active
          ? "bg-foreground/8 font-medium text-foreground"
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
