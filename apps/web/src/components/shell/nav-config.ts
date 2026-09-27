import type { NavIconName } from "./icons";

export type NavLeaf = {
  label: string;
  icon: NavIconName;
  /** Route path; may carry `:organizationId`, resolved against the active organization. */
  path: string;
  /** Shown only to these organization roles; every role when omitted. */
  roles?: readonly string[];
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
 * resolves to a real route in router.tsx; the reference mockup's
 * illustrative Projects/Activity/Reports/Members sections are not real
 * destinations, so they are not listed.
 *
 * Groups render as the reference's labelled sections ("จัดการ" in the
 * mockup) — a small heading above a flat run of links, not an accordion.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "ภาพรวม", icon: "grid", path: "/workspace" },
  { label: "การแจ้งเตือน", icon: "inbox", path: "/notifications" },
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
  {
    label: "องค์กร",
    children: [
      {
        label: "ตั้งค่าการแจ้งเตือน",
        icon: "bell",
        path: "/organizations/:organizationId/notification-settings",
        roles: ["owner", "admin"],
      },
    ],
  },
];

const ORG_PARAM = ":organizationId";

/** Concrete href for a leaf, or null when it needs an organization and there is none. */
export function resolveNavPath(
  path: string,
  organizationId: string | null,
): string | null {
  if (!path.includes(ORG_PARAM)) {
    return path;
  }
  return organizationId === null
    ? null
    : path.replace(ORG_PARAM, organizationId);
}

/** Prefix-active: the leaf's own path or anything nested under it. */
export function isLeafActive(
  leaf: Pick<NavLeaf, "path">,
  pathname: string,
): boolean {
  const pattern = new RegExp(`^${leaf.path.replace(ORG_PARAM, "[^/]+")}(/|$)`);
  return pattern.test(pathname);
}

export function canSeeLeaf(leaf: NavLeaf, role: string | null): boolean {
  return (
    leaf.roles === undefined || (role !== null && leaf.roles.includes(role))
  );
}

/** The active organization as the nav sees it: id for hrefs, role for visibility. */
export type NavContext = { organizationId: string | null; role: string | null };

export type NavDestination = Omit<NavLeaf, "palette" | "roles"> & {
  group?: string;
};

/**
 * Every navigable destination for this context, flattened, tagged with
 * its section label, with organization paths resolved. A leaf's palette
 * entries follow the leaf itself and are grouped under it. Leaves the
 * context cannot see or resolve are left out.
 */
export function getNavDestinations(context: NavContext): NavDestination[] {
  const leaves: { leaf: NavLeaf; group?: string }[] = NAV_ITEMS.flatMap(
    (item) =>
      isNavGroup(item)
        ? item.children.map((leaf) => ({ leaf, group: item.label }))
        : [{ leaf: item }],
  );
  return leaves.flatMap(({ leaf, group }) => {
    const path = resolveNavPath(leaf.path, context.organizationId);
    if (path === null || !canSeeLeaf(leaf, context.role)) {
      return [];
    }
    const own: NavDestination = { label: leaf.label, icon: leaf.icon, path };
    if (group !== undefined) {
      own.group = group;
    }
    const subs: NavDestination[] = (leaf.palette ?? []).map((entry) => ({
      label: entry.label,
      icon: entry.icon,
      path: entry.path,
      group: leaf.label,
    }));
    return [own, ...subs];
  });
}

/**
 * The organization an organization-scoped route names, from the pathname
 * itself; null off such routes. A bookmarked URL may name a different
 * organization than the account-global active one, and the shell must
 * then present the route's organization as the scope the page acts on.
 */
export function getRouteOrganizationId(pathname: string): string | null {
  for (const leaf of getAllNavLeaves()) {
    if (!leaf.path.includes(ORG_PARAM)) {
      continue;
    }
    const match = new RegExp(
      `^${leaf.path.replace(ORG_PARAM, "([^/]+)")}(/|$)`,
    ).exec(pathname);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return null;
}

/** Every leaf (own and palette) regardless of context, for label lookups. */
export function getAllNavLeaves(): NavLeaf[] {
  return NAV_ITEMS.flatMap((item) =>
    isNavGroup(item) ? item.children : [item],
  ).flatMap((leaf) => [leaf, ...(leaf.palette ?? [])]);
}
