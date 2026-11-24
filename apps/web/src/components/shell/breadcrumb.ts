import { getAllNavLeaves, isLeafActive } from "./nav-config";

export type BreadcrumbCrumb = { label: string; path?: string };

// Pages below a nav leaf that get their own crumb after the leaf's. The first capture is the
// parent's path. Pages not listed keep the leaf's crumb alone.
const SUB_PAGES: { pattern: RegExp; label: string }[] = [
  {
    pattern:
      /^(\/organizations\/[^/]+\/projects\/[^/]+\/inventory)\/import\/?$/i,
    label: "Import",
  },
  {
    pattern:
      /^(\/organizations\/[^/]+\/projects\/[^/]+\/inventory)\/mappings\/?$/i,
    label: "ยืนยัน CPE/purl",
  },
  {
    pattern:
      /^(\/organizations\/[^/]+\/projects\/[^/]+\/inventory)\/systems\/[^/]+\/?$/i,
    label: "System",
  },
];

// Derived from NAV_ITEMS so the crumb and sidebar entry can't disagree. Section labels are
// deliberately not crumbs; org-scoped leaves match on route shape so no raw id is shown.
export function getBreadcrumbTrail(pathname: string): BreadcrumbCrumb[] {
  for (const { pattern, label } of SUB_PAGES) {
    const parentPath = pattern.exec(pathname)?.[1];
    if (parentPath !== undefined) {
      return [...getBreadcrumbTrail(parentPath), { label, path: pathname }];
    }
  }
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
