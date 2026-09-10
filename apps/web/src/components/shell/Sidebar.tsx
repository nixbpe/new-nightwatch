import { useState } from "react";
import { NavLink, useLocation } from "react-router";

import { ChevronDownIcon, ChevronRightIcon, NAV_ICONS } from "./icons";
import { NAV_ITEMS, type NavItem } from "./nav-config";

/**
 * Config-driven sidebar (Step 2): renders NAV_ITEMS (nav-config.ts) —
 * nested groups, active-state highlighting, an icon-only collapsed mode,
 * and (via the mobile-drawer props) a slide-in overlay below `sm`. Same
 * design-system tokens as Step 1's plain link list; no new styles.
 */

function isItemActive(item: NavItem, pathname: string): boolean {
  if (item.path !== undefined) {
    return pathname === item.path || pathname.startsWith(`${item.path}/`);
  }
  return (item.children ?? []).some((child) => isItemActive(child, pathname));
}

function rowClasses(active: boolean, indent = false): string {
  const base = `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${
    indent ? "ms-4" : ""
  }`;
  return active
    ? `${base} bg-background font-medium text-foreground`
    : `${base} text-foreground-secondary hover:bg-background hover:text-foreground`;
}

export function Sidebar({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        NAV_ITEMS.filter(
          (item) => item.children !== undefined && isItemActive(item, pathname),
        ).map((item) => item.label),
      ),
  );

  if (collapsed) {
    // Icon-only strip: groups flatten to their children's icons (there is
    // no room to show a nested flyout for the one group this app has
    // today — see nav-config.ts).
    const flat = NAV_ITEMS.flatMap((item) => item.children ?? [item]);
    return (
      <nav aria-label="เมนูหลัก" className="flex flex-col gap-1 px-2">
        {flat.map((item) => {
          const Icon = NAV_ICONS[item.icon];
          const active = isItemActive(item, pathname);
          return (
            <NavLink
              key={item.label}
              to={item.path ?? "#"}
              title={item.label}
              aria-label={item.label}
              onClick={onNavigate}
              className={`flex items-center justify-center rounded-md p-2 ${
                active
                  ? "bg-background text-foreground"
                  : "text-foreground-secondary hover:bg-background hover:text-foreground"
              }`}
            >
              <Icon />
            </NavLink>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="เมนูหลัก" className="flex flex-col gap-1 px-2">
      {NAV_ITEMS.map((item) => {
        const Icon = NAV_ICONS[item.icon];
        if (item.path !== undefined) {
          return (
            <NavLink
              key={item.label}
              to={item.path}
              onClick={onNavigate}
              className={({ isActive }) => rowClasses(isActive)}
            >
              <Icon />
              <span>{item.label}</span>
            </NavLink>
          );
        }

        const isOpen = expanded.has(item.label);
        const groupActive = isItemActive(item, pathname);
        return (
          <div key={item.label}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => {
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(item.label)) {
                    next.delete(item.label);
                  } else {
                    next.add(item.label);
                  }
                  return next;
                });
              }}
              className={`w-full ${rowClasses(groupActive && !isOpen)}`}
            >
              <Icon />
              <span className="flex-1 text-left">{item.label}</span>
              {isOpen ? (
                <ChevronDownIcon size={14} />
              ) : (
                <ChevronRightIcon size={14} />
              )}
            </button>
            {isOpen ? (
              <div className="mt-1 flex flex-col gap-1">
                {(item.children ?? []).map((child) => {
                  const ChildIcon = NAV_ICONS[child.icon];
                  return (
                    <NavLink
                      key={child.label}
                      to={child.path ?? "#"}
                      onClick={onNavigate}
                      className={({ isActive }) => rowClasses(isActive, true)}
                    >
                      <ChildIcon />
                      <span>{child.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
