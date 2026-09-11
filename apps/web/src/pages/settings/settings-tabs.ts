import type { NavIconName } from "../../components/shell/icons";

export type SettingsTab = {
  key: "profile" | "security" | "sessions" | "display";
  label: string;
  icon: NavIconName;
  path: string;
};

/** Tab strip of the personal-settings page; one entry per /settings child route. */
export const SETTINGS_TABS: SettingsTab[] = [
  { key: "profile", label: "โปรไฟล์", icon: "user", path: "/settings/profile" },
  {
    key: "security",
    label: "ความปลอดภัย",
    icon: "shield",
    path: "/settings/security",
  },
  {
    key: "sessions",
    label: "เซสชันและอุปกรณ์",
    icon: "monitor",
    path: "/settings/sessions",
  },
  {
    key: "display",
    label: "การแสดงผล",
    icon: "sliders",
    path: "/settings/display",
  },
];
