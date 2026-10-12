import type { NavIconName } from "./icons";

export type NavLeaf = {
  label: string;
  icon: NavIconName;
  /** May carry `:organizationId` (the active organization) and `:projectId` (the current Project). */
  path: string;
  /** Every role when omitted. */
  roles?: readonly string[];
  /** Searchable in the command palette but never rendered as sidebar rows. */
  palette?: NavLeaf[];
  /** Server count shown at the row's end (`aria-hidden`, hidden when unknown). */
  count?: NavCountSource;
};

/** `monitors`: the active organization's monitor `summary.total`; `unread`: the inbox unread count. */
export type NavCountSource = "monitors" | "unread";

/** What a group's pages belong to: the current Project, the active organization or the signed-in user. */
export type NavScope = "project" | "organization" | "personal";

export type NavGroup = {
  label: string;
  scope: NavScope;
  children: NavLeaf[];
};

export type NavItem = NavLeaf | NavGroup;

export function isNavGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

// Leaves must be real routes in router.tsx; the mockup's placeholder sections are intentionally omitted.
// The Project group lists only pages that exist under a Project; the switcher above it is not a leaf.
export const NAV_ITEMS: NavItem[] = [
  // The organization's overview and monitors stay top-level, as before Project scope existed.
  { label: "ภาพรวม", icon: "grid", path: "/workspace" },
  {
    label: "ตรวจสถานะบริการ",
    icon: "activity",
    path: "/organizations/:organizationId/monitors",
    count: "monitors",
  },
  {
    label: "โปรเจกต์",
    scope: "project",
    children: [
      {
        label: "สมาชิกโปรเจกต์",
        icon: "users",
        path: "/organizations/:organizationId/projects/:projectId/members",
      },
    ],
  },
  {
    label: "องค์กร",
    scope: "organization",
    children: [
      {
        label: "โปรเจกต์ทั้งหมด",
        icon: "grid",
        path: "/organizations/:organizationId/projects",
      },
      {
        label: "สมาชิก",
        icon: "users",
        path: "/organizations/:organizationId/members",
      },
      {
        label: "ตั้งค่าการแจ้งเตือน",
        icon: "bell",
        path: "/organizations/:organizationId/notification-settings",
        roles: ["owner", "admin"],
      },
      {
        label: "บันทึกกิจกรรม",
        icon: "history",
        path: "/organizations/:organizationId/audit-log",
        roles: ["owner", "admin", "auditor"],
      },
    ],
  },
  {
    label: "ส่วนตัว",
    scope: "personal",
    children: [
      {
        label: "การแจ้งเตือน",
        icon: "inbox",
        path: "/notifications",
        count: "unread",
      },
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

// The Projects page opens its create dialog for `?create=1`, so the switcher links there instead of duplicating the dialog.
export const CREATE_PROJECT_PARAM = "create";

const ORG_PARAM = ":organizationId";
const PROJECT_PARAM = ":projectId";

/** Null when the path needs an organization or a Project that is not known. */
export function resolveNavPath(
  path: string,
  organizationId: string | null,
  projectId: string | null = null,
): string | null {
  if (
    (path.includes(ORG_PARAM) && organizationId === null) ||
    (path.includes(PROJECT_PARAM) && projectId === null)
  ) {
    return null;
  }
  return path
    .replace(ORG_PARAM, organizationId ?? "")
    .replace(PROJECT_PARAM, projectId ?? "");
}

// Matches the leaf's path or anything below it, so a detail page keeps its list leaf active.
function leafPattern(path: string, captureOrganization = false): RegExp {
  const source = path
    .replace(ORG_PARAM, captureOrganization ? "([^/]+)" : "[^/]+")
    .replace(PROJECT_PARAM, "[^/]+");
  // Case-insensitive: the nav links carry the canonical lowercase ids, the URL may not.
  return new RegExp(`^${source}(/|$)`, "i");
}

export function isLeafActive(
  leaf: Pick<NavLeaf, "path">,
  pathname: string,
): boolean {
  return leafPattern(leaf.path).test(pathname);
}

/** The longest matching path wins, so a leaf and the list above it are not both current. */
export function mostSpecificLeaf<T extends Pick<NavLeaf, "path">>(
  leaves: readonly T[],
  pathname: string,
): T | undefined {
  return leaves
    .filter((leaf) => isLeafActive(leaf, pathname))
    .reduce<T | undefined>(
      (best, leaf) =>
        best === undefined || leaf.path.length > best.path.length ? leaf : best,
      undefined,
    );
}

/** Leaves that live under a Project, in nav order; the first one is where a Project opens. */
export function getProjectLeaves(): NavLeaf[] {
  return NAV_ITEMS.flatMap((item) =>
    isNavGroup(item) && item.scope === "project" ? item.children : [],
  );
}

/**
 * Where a Project switch lands. The same page of the new Project when the URL
 * is on a Project leaf; a detail page (a monitor, say) falls to the leaf above
 * it, which is its list. Anywhere else, the first Project leaf.
 */
export function projectSwitchDestination(
  pathname: string,
  organizationId: string,
  projectId: string,
  leaves: readonly NavLeaf[] = getProjectLeaves(),
): string | null {
  const target =
    mostSpecificLeaf(
      leaves.filter((leaf) => leaf.path.includes(PROJECT_PARAM)),
      pathname,
    ) ?? leaves[0];
  return target === undefined
    ? null
    : resolveNavPath(target.path, organizationId, projectId);
}

/**
 * The Organization and Project a Project route names. The Project id is lowercased here: the API accepts any
 * case and answers with the lowercase id, which the shell compares against, saves and links to.
 */
export function getProjectRoute(
  pathname: string,
): { organizationId: string; projectId: string } | null {
  const match = /^\/organizations\/([^/]+)\/projects\/([^/]+)(?:\/|$)/.exec(
    pathname,
  );
  return match?.[1] !== undefined && match[2] !== undefined
    ? { organizationId: match[1], projectId: match[2].toLowerCase() }
    : null;
}

export function canSeeLeaf(leaf: NavLeaf, role: string | null): boolean {
  return (
    leaf.roles === undefined || (role !== null && leaf.roles.includes(role))
  );
}

export type NavContext = {
  organizationId: string | null;
  projectId: string | null;
  /** The Organization that owns `projectId`; the active one when omitted. */
  projectOrganizationId?: string | null;
  role: string | null;
};

export type NavDestination = Omit<NavLeaf, "palette" | "roles" | "count"> & {
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
    const path = resolveNavPath(
      leaf.path,
      leaf.path.includes(PROJECT_PARAM)
        ? (context.projectOrganizationId ?? context.organizationId)
        : context.organizationId,
      context.projectId,
    );
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
    const match = leafPattern(leaf.path, true).exec(pathname);
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
