import { getAllNavLeaves, isLeafActive } from "./nav-config";

export type BreadcrumbCrumb = { label: string; path?: string };

// Derived from NAV_ITEMS so the crumb and sidebar entry can't disagree. Section labels are
// deliberately not crumbs; org-scoped leaves match on route shape so no raw id is shown.
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
