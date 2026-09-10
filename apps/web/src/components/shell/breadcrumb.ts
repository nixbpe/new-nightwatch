import { NAV_ITEMS, type NavItem } from "./nav-config";

export type BreadcrumbCrumb = { label: string; path?: string };

/**
 * Breadcrumb derived from the current route, via NAV_ITEMS — the sidebar
 * config is the one source of truth for both, so a page's breadcrumb and
 * its sidebar entry can never disagree. Falls back to the raw path
 * segments for a route that isn't in the nav (kept for robustness; every
 * route today does resolve through NAV_ITEMS).
 */
export function getBreadcrumbTrail(pathname: string): BreadcrumbCrumb[] {
  const trail = findTrail(NAV_ITEMS, pathname);
  if (trail !== null) {
    return trail;
  }
  const segments = pathname.split("/").filter((segment) => segment !== "");
  return segments.map((segment, index) => ({
    label: segment,
    path: `/${segments.slice(0, index + 1).join("/")}`,
  }));
}

function findTrail(
  items: NavItem[],
  pathname: string,
): BreadcrumbCrumb[] | null {
  for (const item of items) {
    if (item.path === pathname) {
      return [{ label: item.label, path: item.path }];
    }
    if (item.children !== undefined) {
      const childTrail = findTrail(item.children, pathname);
      if (childTrail !== null) {
        return [{ label: item.label, path: item.path }, ...childTrail];
      }
    }
  }
  return null;
}
