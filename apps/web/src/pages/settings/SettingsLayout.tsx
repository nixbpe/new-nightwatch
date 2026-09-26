import { NavLink, Outlet, useLocation } from "react-router";

import { NAV_ICONS } from "../../components/shell/icons";
import { Page, PageHeader } from "../../components/shell/Page";
import { Skeleton } from "../../components/shell/Skeleton";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { SETTINGS_TABS } from "./settings-tabs";

/**
 * Personal-settings page frame: header, tab strip, and the routed tab. The
 * settings apply to the account across organizations, so the description
 * says so explicitly (design-system: keep scope visible).
 */
export function SettingsLayout() {
  const { me, mePending, activeOrg } = useTenant();
  const { pathname } = useLocation();
  const name = me?.user.name ?? "";

  return (
    <Page>
      <PageHeader
        eyebrow={
          mePending ? (
            <Skeleton className="h-3 w-40 align-middle" />
          ) : name === "" ? (
            "บัญชีของฉัน"
          ) : (
            `${name} · บัญชีของฉัน`
          )
        }
        title="การตั้งค่าส่วนตัว"
        description={
          activeOrg === null
            ? "ใช้กับบัญชีของคุณในทุกองค์กร"
            : `ใช้กับบัญชีของคุณในทุกองค์กร ไม่ใช่การตั้งค่าขององค์กร ${activeOrg.name}`
        }
      />

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

      <div className="min-w-0">
        <Outlet />
      </div>
    </Page>
  );
}
