/**
 * Inline stroke-based icons for the app shell (sidebar nav, org switcher,
 * account menu, header controls, overlays) — same style already
 * established in pages/LoginPage.tsx, no new icon library dependency.
 */
function iconProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function GridIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function ShieldIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

export function SlidersIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <line x1="21" x2="14" y1="4" y2="4" />
      <line x1="10" x2="3" y1="4" y2="4" />
      <line x1="21" x2="12" y1="12" y2="12" />
      <line x1="8" x2="3" y1="12" y2="12" />
      <line x1="21" x2="16" y1="20" y2="20" />
      <line x1="12" x2="3" y1="20" y2="20" />
      <line x1="14" x2="14" y1="2" y2="6" />
      <line x1="8" x2="8" y1="10" y2="14" />
      <line x1="16" x2="16" y1="18" y2="22" />
    </svg>
  );
}

export function ChevronsUpDownIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function PanelLeftIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

export function MenuIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

export function XIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function SearchIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function BellIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function UserIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function MonitorIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

export function LogOutIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

export function SmartphoneIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}

export function KeyIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}

export function CopyIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function DownloadIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

export function RefreshIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/** Registry keyed by the string name used in nav-config.ts's NavItem.icon. */
export const NAV_ICONS = {
  grid: GridIcon,
  shield: ShieldIcon,
  sliders: SlidersIcon,
  user: UserIcon,
  monitor: MonitorIcon,
} as const;

export type NavIconName = keyof typeof NAV_ICONS;
