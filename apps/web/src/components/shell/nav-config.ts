import type { NavIconName } from "./icons";

export type NavLeaf = { label: string; icon: NavIconName; path: string };

/** A labelled section of the sidebar (rendered as a heading, never a link). */
export type NavGroup = { label: string; children: NavLeaf[] };

export type NavItem = NavLeaf | NavGroup;

export function isNavGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

/**
 * The sidebar's only source of truth for menu structure. Every leaf here
 * must resolve to a real route in router.tsx (confirmed with the user:
 * only /workspace and /settings/security exist today — the reference
 * mockup's illustrative Projects/Activity/Reports/Members sections are not
 * real destinations, so they are not listed here).
 *
 * Groups render as the reference's labelled sections ("จัดการ" in the
 * mockup) — a small heading above a flat run of links, not an accordion.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "ภาพรวม", icon: "grid", path: "/workspace" },
  {
    label: "ตั้งค่า",
    children: [
      {
        label: "ความปลอดภัยบัญชี",
        icon: "shield",
        path: "/settings/security",
      },
    ],
  },
];

export function isLeafActive(leaf: NavLeaf, pathname: string): boolean {
  return pathname === leaf.path || pathname.startsWith(`${leaf.path}/`);
}

export type NavDestination = NavLeaf & { group?: string };

/** Every navigable destination, flattened, tagged with its section label. */
export function getNavDestinations(): NavDestination[] {
  return NAV_ITEMS.flatMap((item) =>
    isNavGroup(item)
      ? item.children.map((leaf) => ({ ...leaf, group: item.label }))
      : [item],
  );
}
