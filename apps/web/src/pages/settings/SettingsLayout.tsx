import { NavLink, Outlet, useLocation } from "react-router";

import { NAV_ICONS } from "../../components/shell/icons";
import { Skeleton } from "../../components/shell/Skeleton";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { SETTINGS_TABS } from "./settings-tabs";

/**
 * Personal-settings page frame: header, tab strip, and the routed tab. The
 * settings apply to the account across organizations, so the subtitle says
 * so explicitly (design-system: keep scope visible).
 */
export function SettingsLayout() {
  const { me, mePending, activeOrg } = useTenant();
  const { pathname } = useLocation();
  const name = me?.user.name ?? "";

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs text-foreground-secondary">
          {mePending ? (
            <Skeleton className="h-3 w-40 align-middle" />
          ) : name === "" ? (
            "บัญชีของฉัน"
          ) : (
            `${name} · บัญชีของฉัน`
          )}
        </p>
        <h1 className="mt-1.5 text-[28px] leading-9 font-semibold tracking-tight">
          การตั้งค่าส่วนตัว
        </h1>
        <p className="mt-1.5 text-sm text-foreground-secondary">
          ใช้กับบัญชีของคุณในทุกองค์กร
          {activeOrg === null
            ? ""
            : ` — ไม่ใช่การตั้งค่าขององค์กร ${activeOrg.name}`}
        </p>
      </header>

      <nav
        role="tablist"
        aria-label="หมวดการตั้งค่า"
        className="flex gap-1 overflow-x-auto border-b border-foreground/10"
      >
        {SETTINGS_TABS.map((tab) => {
          const Icon = NAV_ICONS[tab.icon];
          const active =
            pathname === tab.path || pathname.startsWith(`${tab.path}/`);
          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              role="tab"
              aria-selected={active}
              className={`-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap ${
                active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-foreground-secondary hover:text-foreground"
              }`}
            >
              <span className={active ? "text-primary" : ""}>
                <Icon size={16} />
              </span>
              {tab.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="min-w-0 max-w-[960px]">
        <Outlet />
      </div>
    </div>
  );
}
