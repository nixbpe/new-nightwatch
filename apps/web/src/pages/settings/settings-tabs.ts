import {
  isNavGroup,
  NAV_ITEMS,
  type NavLeaf,
} from "../../components/shell/nav-config";

export type SettingsTab = Pick<NavLeaf, "label" | "icon" | "path">;

const settingsLeaf = NAV_ITEMS.flatMap((item) =>
  isNavGroup(item) ? item.children : [item],
).find((leaf) => leaf.path === "/settings");

if (settingsLeaf?.palette === undefined) {
  throw new Error(
    "nav-config.ts must declare the /settings leaf with palette entries",
  );
}

/**
 * Tab strip of the personal-settings page — the nav leaf's palette entries,
 * so the sidebar, the command palette and this strip share one definition.
 */
export const SETTINGS_TABS: SettingsTab[] = settingsLeaf.palette.map(
  ({ label, icon, path }) => ({ label, icon, path }),
);
