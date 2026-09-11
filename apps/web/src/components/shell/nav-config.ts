import type { NavIconName } from "./icons";

export type NavLeaf = {
  label: string;
  icon: NavIconName;
  path: string;
  /**
   * Sub-destinations searchable in the command palette but never rendered
   * as sidebar rows (a page's own tabs, for instance). Listed under the
   * leaf's label as their group.
   */
  palette?: NavLeaf[];
};

/** A labelled section of the sidebar (rendered as a heading, never a link). */
export type NavGroup = { label: string; children: NavLeaf[] };

export type NavItem = NavLeaf | NavGroup;

export function isNavGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

/**
 * The sidebar's only source of truth for menu structure. Every leaf here
 * must resolve to a real route in router.tsx (confirmed with the user:
 * only /workspace and /settings/* exist today — the reference mockup's
 * illustrative Projects/Activity/Reports/Members sections are not real
 * destinations, so they are not listed here).
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
        label: "การตั้งค่าส่วนตัว",
        icon: "sliders",
        path: "/settings",
        palette: [
          { label: "โปรไฟล์", icon: "user", path: "/settings/profile" },
          { label: "ความปลอดภัย", icon: "shield", path: "/settings/security" },
          {
            label: "เซสชันและอุปกรณ์",
            icon: "monitor",
            path: "/settings/sessions",
          },
          { label: "การแสดงผล", icon: "sliders", path: "/settings/display" },
        ],
      },
    ],
  },
];

export function isLeafActive(leaf: NavLeaf, pathname: string): boolean {
  return pathname === leaf.path || pathname.startsWith(`${leaf.path}/`);
}

export type NavDestination = Omit<NavLeaf, "palette"> & { group?: string };

/**
 * Every navigable destination, flattened, tagged with its section label.
 * A leaf's palette entries follow the leaf itself (so prefix matching in
 * breadcrumb.ts still resolves to the leaf) and are grouped under it.
 */
export function getNavDestinations(): NavDestination[] {
  const leaves: { leaf: NavLeaf; group?: string }[] = NAV_ITEMS.flatMap(
    (item) =>
      isNavGroup(item)
        ? item.children.map((leaf) => ({ leaf, group: item.label }))
        : [{ leaf: item }],
  );
  return leaves.flatMap(({ leaf, group }) => {
    const { palette, ...destination } = leaf;
    const own: NavDestination =
      group === undefined ? destination : { ...destination, group };
    const subs: NavDestination[] = (palette ?? []).map((entry) => ({
      label: entry.label,
      icon: entry.icon,
      path: entry.path,
      group: leaf.label,
    }));
    return [own, ...subs];
  });
}
