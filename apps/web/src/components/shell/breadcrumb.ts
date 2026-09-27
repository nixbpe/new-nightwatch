import { getAllNavLeaves, isLeafActive } from "./nav-config";

export type BreadcrumbCrumb = { label: string; path?: string };

/**
 * Page crumb(s) for the current route, derived from the same NAV_ITEMS the
 * sidebar renders, so a page's breadcrumb and its sidebar entry can never
 * disagree. Section labels are deliberately not crumbs (the reference
 * shows "Orbit Digital › สมาชิก", not "… › จัดการ › สมาชิก"); the header
 * prepends the active organization as the root crumb. Organization-scoped
 * leaves match on their route shape, so the crumb never shows a raw id.
 * Anything off the nav falls back to raw path segments.
 */
export function getBreadcrumbTrail(pathname: string): BreadcrumbCrumb[] {
  const leaf = getAllNavLeaves().find((entry) => isLeafActive(entry, pathname));
  if (leaf !== undefined) {
    return [{ label: leaf.label, path: pathname }];
  }
  const segments = pathname.split("/").filter((segment) => segment !== "");
  return segments.map((segment, index) => ({
    label: segment,
    path: `/${segments.slice(0, index + 1).join("/")}`,
  }));
}
