import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { authClient } from "../../lib/auth-client";
import { useTheme, type ThemePreference } from "../../lib/theme";
import { getBreadcrumbTrail } from "./breadcrumb";
import {
  BellIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LogOutIcon,
  MenuIcon,
  MonitorIcon,
  SearchIcon,
  ShieldIcon,
  UserIcon,
} from "./icons";

/**
 * Header (Step 3): logo slot, breadcrumb derived from the current route
 * (breadcrumb.ts, sourced from the same NAV_ITEMS as the sidebar), a
 * search and a notification placeholder (both genuinely inert — disabled,
 * not just unstyled, so they don't read as broken features), and a user
 * avatar dropdown. "Profile" has no real destination yet and is marked as
 * such; "settings" and "sign out" stay fully functional (moved here from
 * Step 1's plain header button). Step 6 adds the persisted theme toggle
 * inside that same dropdown (lib/theme.ts).
 */
export function Header({ onOpenMobileMenu }: { onOpenMobileMenu: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data } = authClient.useSession();
  const { theme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        menuRef.current !== null &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const trail = getBreadcrumbTrail(pathname);
  const email = data?.user.email ?? "";
  const initial = email === "" ? "" : email.charAt(0).toUpperCase();

  return (
    <header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-control-border/40 bg-surface px-4">
      <button
        type="button"
        aria-label="เปิดเมนู"
        onClick={onOpenMobileMenu}
        className="-ms-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground-secondary hover:bg-background hover:text-foreground sm:hidden"
      >
        <MenuIcon />
      </button>

      {/* Logo slot */}
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-on-primary">
          <ShieldIcon size={16} />
        </span>
        <span className="hidden text-lg font-semibold sm:inline">
          NightWatch
        </span>
      </div>

      {/* Breadcrumb, derived from the current route (breadcrumb.ts) */}
      <nav aria-label="ตำแหน่งปัจจุบัน" className="hidden min-w-0 md:block">
        <ol className="flex items-center gap-1.5 text-sm text-foreground-secondary">
          {trail.map((crumb, index) => {
            const isLast = index === trail.length - 1;
            return (
              <li
                key={`${crumb.label}-${String(index)}`}
                className="flex items-center gap-1.5"
              >
                {index > 0 ? <ChevronRightIcon size={14} /> : null}
                {crumb.path !== undefined && !isLast ? (
                  <Link to={crumb.path} className="hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className={isLast ? "font-medium text-foreground" : ""}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="ms-auto flex items-center gap-2">
        {/* Search placeholder — genuinely inert (disabled), not a dead-looking button. */}
        <button
          type="button"
          disabled
          aria-label="ค้นหา (ยังไม่เปิดใช้งาน)"
          className="hidden h-9 items-center gap-2 rounded-md border border-control-border bg-surface px-3 text-sm text-foreground-secondary disabled:cursor-not-allowed disabled:opacity-60 sm:flex"
        >
          <SearchIcon size={16} />
          <span>ค้นหา…</span>
        </button>
        <button
          type="button"
          disabled
          aria-label="การแจ้งเตือน (ยังไม่เปิดใช้งาน)"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground-secondary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <BellIcon size={18} />
        </button>

        {/* User avatar dropdown */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((value) => !value);
            }}
            className="flex h-9 items-center gap-1.5 rounded-md px-1.5 hover:bg-background"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background text-sm font-medium">
              {initial === "" ? <UserIcon size={16} /> : initial}
            </span>
            <ChevronDownIcon size={14} />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              aria-label="บัญชีของฉัน"
              className="absolute right-0 z-50 mt-1 w-56 rounded-md border border-control-border/40 bg-surface p-1 shadow-sm"
            >
              {email === "" ? null : (
                <div className="truncate px-2.5 py-2 text-sm text-foreground-secondary">
                  {email}
                </div>
              )}
              <div
                role="menuitem"
                aria-disabled="true"
                className="flex cursor-not-allowed items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground-secondary/70"
              >
                <UserIcon size={16} />
                <span>โปรไฟล์ (เร็ว ๆ นี้)</span>
              </div>
              <Link
                role="menuitem"
                to="/settings/security"
                onClick={() => {
                  setMenuOpen(false);
                }}
                className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-background"
              >
                <ShieldIcon size={16} />
                <span>ตั้งค่าความปลอดภัย</span>
              </Link>
              <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-foreground">
                <MonitorIcon size={16} />
                <span className="flex-1">ธีม</span>
                <ThemeSegmentedControl theme={theme} onChange={setTheme} />
              </div>
              <div className="my-1 h-px bg-control-border/40" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void authClient.signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        void navigate("/login", { replace: true });
                      },
                    },
                  });
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm text-foreground hover:bg-background"
              >
                <LogOutIcon size={16} />
                <span>ออกจากระบบ</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "สว่าง" },
  { value: "dark", label: "มืด" },
  { value: "system", label: "ระบบ" },
];

function ThemeSegmentedControl({
  theme,
  onChange,
}: {
  theme: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  return (
    <div
      role="group"
      aria-label="ธีม"
      className="flex gap-0.5 rounded-md bg-background p-0.5"
    >
      {THEME_OPTIONS.map((option) => {
        const active = option.value === theme;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              onChange(option.value);
            }}
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              active
                ? "bg-surface text-foreground shadow-sm"
                : "text-foreground-secondary"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
