import type { NavIconName } from "./icons";

export type NavLeaf = {
  label: string;
  icon: NavIconName;
  /** May carry `:organizationId`, resolved against the active organization. */
  path: string;
  /** Every role when omitted. */
  roles?: readonly string[];
  /** Searchable in the command palette but never rendered as sidebar rows. */
  palette?: NavLeaf[];
};

export type NavGroup = { label: string; children: NavLeaf[] };

export type NavItem = NavLeaf | NavGroup;

export function isNavGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

// Leaves must be real routes in router.tsx; the mockup's placeholder sections are intentionally omitted.
export const NAV_ITEMS: NavItem[] = [
  { label: "ภาพรวม", icon: "grid", path: "/workspace" },
  {
    label: "ตรวจสถานะบริการ",
    icon: "activity",
    path: "/organizations/:organizationId/monitors",
  },
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
        label: "สมาชิก",
        icon: "user",
        path: "/organizations/:organizationId/members",
      },
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

export type NavContext = { organizationId: string | null; role: string | null };

export type NavDestination = Omit<NavLeaf, "palette" | "roles"> & {
  group?: string;
};

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

// A bookmarked URL may name a different organization than the active one; the shell then
// presents the route's organization as the page's scope.
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

export function getAllNavLeaves(): NavLeaf[] {
  return NAV_ITEMS.flatMap((item) =>
    isNavGroup(item) ? item.children : [item],
  ).flatMap((leaf) => [leaf, ...(leaf.palette ?? [])]);
}
