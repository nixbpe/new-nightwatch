import { NavLink, Outlet, useLocation } from "react-router";

import { NAV_ICONS } from "../../components/shell/icons";
import { Page, PageHeader } from "../../components/shell/Page";
import { Skeleton } from "../../components/shell/Skeleton";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { SETTINGS_TABS } from "./settings-tabs";

function isActiveTab(path: string, pathname: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}
function tabId(path: string) {
  return `settings-tab-${path.split("/").pop() ?? ""}`;
}

export function SettingsLayout() {
  const { me, mePending, activeOrg } = useTenant();
  const { pathname } = useLocation();
  const activeTab = SETTINGS_TABS.find((tab) =>
    isActiveTab(tab.path, pathname),
  );
  const name = me?.user.name ?? "";

  return (
    <Page width="form">
      <PageHeader
        scope={
          mePending
            ? { label: <Skeleton className="h-3 w-40 align-middle" /> }
            : name === ""
              ? { label: "บัญชีของฉัน" }
              : {
                  mark: name,
                  markShape: "person",
                  label: name,
                  tag: "บัญชีของฉัน",
                }
        }
        title="การตั้งค่าส่วนตัว"
        description={
          activeOrg === null
            ? "ใช้กับบัญชีของคุณในทุกองค์กร"
            : `ใช้กับบัญชีของคุณในทุกองค์กร ไม่ใช่การตั้งค่าขององค์กร ${activeOrg.name}`
        }
      />

      <div className="border-b border-foreground/10">
        <nav
          role="tablist"
          aria-label="หมวดการตั้งค่า"
          className="-mb-px flex flex-wrap gap-x-6"
        >
          {SETTINGS_TABS.map((tab) => {
            const Icon = NAV_ICONS[tab.icon];
            const active = isActiveTab(tab.path, pathname);
            return (
              <NavLink
                key={tab.path}
                id={tabId(tab.path)}
                to={tab.path}
                role="tab"
                aria-selected={active}
                className={`inline-flex h-10 items-center gap-2 border-b-2 px-1 text-sm whitespace-nowrap transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
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
      </div>

      <div
        role="tabpanel"
        aria-labelledby={
          activeTab === undefined ? undefined : tabId(activeTab.path)
        }
        className="min-w-0"
      >
        <Outlet />
      </div>
    </Page>
  );
}
