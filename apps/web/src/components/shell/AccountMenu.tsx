import { Link, useNavigate } from "react-router";

import { authClient } from "../../lib/auth-client";
import { ROLE_LABELS } from "../../lib/roles";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { useTheme, type ThemePreference } from "../../lib/theme";
import {
  ChevronsUpDownIcon,
  LogOutIcon,
  MonitorIcon,
  SlidersIcon,
} from "./icons";
import { initialsOf } from "./initials";
import { Skeleton } from "./Skeleton";
import { usePopover } from "./usePopover";

/**
 * Pinned to the bottom of the sidebar, per the reference: avatar, name and
 * email, opening the account menu upward. One link into the personal
 * settings (whose tabs hold profile, security, sessions and display), the
 * theme choice, and sign-out.
 */
export function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const { me, mePending, activeOrg } = useTenant();
  const { data: session } = authClient.useSession();
  const { theme, setTheme } = useTheme();
  const popover = usePopover();

  const email = me?.user.email ?? session?.user.email ?? "";
  const name = me?.user.name ?? session?.user.name ?? email;

  if (mePending && email === "") {
    return (
      <div className="flex h-16 items-center gap-2.5 border-t border-foreground/10 px-4">
        <Skeleton className="h-8 w-8 flex-shrink-0 rounded-full" />
        {collapsed ? null : (
          <span className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-2.5 w-36" />
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative border-t border-foreground/10 p-2">
      <button
        ref={popover.triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={popover.open}
        aria-label={collapsed ? `บัญชี: ${name}` : "เมนูบัญชีผู้ใช้"}
        onClick={popover.toggle}
        className={`flex h-12 w-full items-center gap-2.5 rounded-md hover:bg-foreground/5 ${
          collapsed ? "justify-center" : "px-2"
        }`}
      >
        <Avatar name={name} />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 text-start">
              <span className="block truncate text-sm font-medium text-foreground">
                {name}
              </span>
              <span className="block truncate text-xs text-foreground-secondary">
                {email}
              </span>
            </span>
            <span className="text-foreground-secondary">
              <ChevronsUpDownIcon size={16} />
            </span>
          </>
        )}
      </button>

      {popover.open ? (
        <div
          ref={popover.panelRef}
          role="menu"
          aria-label="บัญชีของฉัน"
          tabIndex={-1}
          className="absolute bottom-full left-2 z-50 mb-2 w-72 rounded-md border border-foreground/10 bg-surface shadow-lg focus:outline-none"
        >
          <div className="flex items-center gap-3 px-3 pt-3">
            <Avatar name={name} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-foreground-secondary">
                {email}
              </p>
            </div>
          </div>
          {activeOrg === null ? (
            <div className="pb-3" />
          ) : (
            <div className="flex items-center gap-2 px-3 pt-2 pb-3 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 px-2 py-0.5 text-foreground">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-foreground-secondary"
                />
                {ROLE_LABELS[activeOrg.role] ?? activeOrg.role}
              </span>
              <span className="truncate text-foreground-secondary">
                {activeOrg.name}
              </span>
            </div>
          )}
          <div className="h-px bg-foreground/10" />
          <div className="p-1">
            <Link
              role="menuitem"
              to="/settings/profile"
              onClick={popover.close}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-foreground/5"
            >
              <SlidersIcon size={16} />
              <span className="flex-1">การตั้งค่าส่วนตัว</span>
            </Link>
            <div className="flex items-center gap-2.5 px-2.5 py-2 text-sm text-foreground">
              <MonitorIcon size={16} />
              <span className="flex-1">ธีม</span>
              <ThemeSegmentedControl theme={theme} onChange={setTheme} />
            </div>
          </div>
          <div className="h-px bg-foreground/10" />
          <div className="p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                popover.close();
                void authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      void navigate("/login", { replace: true });
                    },
                  },
                });
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm text-foreground hover:bg-foreground/5"
            >
              <LogOutIcon size={16} />
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** People stay circular (design system: avatars are the one circular mark). */
function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-surface font-medium text-foreground ${
        size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs"
      }`}
    >
      {initialsOf(name)}
    </span>
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
      className="flex gap-0.5 rounded-md border border-foreground/10 p-0.5"
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
            className={`rounded-md px-2 py-0.5 text-xs font-medium ${
              active
                ? "bg-foreground/8 text-foreground"
                : "text-foreground-secondary hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
