import type { NavIconName } from "./icons";

export type NavItem = {
  label: string;
  icon: NavIconName;
  /** Omitted for a group-only parent (no destination of its own). */
  path?: string;
  children?: NavItem[];
};

/**
 * The sidebar's only source of truth for menu structure. Every entry here
 * must resolve to a real route in router.tsx (confirmed with the user:
 * only /workspace and /settings/security exist today — the mockup's
 * illustrative Projects/Activity/Reports/Members sections are not real
 * destinations, so they are not listed here).
 *
 * "ตั้งค่า" is a group-only parent (no path) wrapping one real child, to
 * demonstrate the nested-groups capability without inventing a route.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "ภาพรวม", icon: "grid", path: "/workspace" },
  {
    label: "ตั้งค่า",
    icon: "sliders",
    children: [
      {
        label: "ความปลอดภัยบัญชี",
        icon: "shield",
        path: "/settings/security",
      },
    ],
  },
];
