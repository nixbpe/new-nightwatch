import { getNavDestinations, isLeafActive } from "./nav-config";

export type BreadcrumbCrumb = { label: string; path?: string };

const OFF_NAV_LABELS: Record<string, string> = {
  "/notifications": "การแจ้งเตือน",
};

/**
 * Page crumb(s) for the current route, derived from the same NAV_ITEMS the
 * sidebar renders, so a page's breadcrumb and its sidebar entry can never
 * disagree. Section labels are deliberately not crumbs (the reference
 * shows "Orbit Digital › สมาชิก", not "… › จัดการ › สมาชิก"); the header
 * prepends the active organization as the root crumb. Off-nav pages use
 * OFF_NAV_LABELS; anything else falls back to raw path segments.
 */
export function getBreadcrumbTrail(pathname: string): BreadcrumbCrumb[] {
  const leaf = getNavDestinations().find((destination) =>
    isLeafActive(destination, pathname),
  );
  if (leaf !== undefined) {
    return [{ label: leaf.label, path: leaf.path }];
  }
  const offNavLabel = OFF_NAV_LABELS[pathname];
  if (offNavLabel !== undefined) {
    return [{ label: offNavLabel, path: pathname }];
  }
  const segments = pathname.split("/").filter((segment) => segment !== "");
  return segments.map((segment, index) => ({
    label: segment,
    path: `/${segments.slice(0, index + 1).join("/")}`,
  }));
}
