import { NavLink, Outlet, useLocation } from "react-router";

import { NAV_ICONS } from "../../components/shell/icons";
import { Page, PageHeader } from "../../components/shell/Page";
import { Skeleton } from "../../components/shell/Skeleton";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { SETTINGS_TABS } from "./settings-tabs";

function isActiveTab(path: string, pathname: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function SettingsLayout() {
  const { me, mePending, activeOrg } = useTenant();
  const { pathname } = useLocation();
  const activeTab = SETTINGS_TABS.find((tab) =>
    isActiveTab(tab.path, pathname),
  );
  const name = me?.user.name ?? "";
  const scope =
    activeTab?.path === "/settings/display"
      ? "ใช้กับเบราว์เซอร์นี้เท่านั้น"
      : "ใช้กับบัญชีของคุณในทุกองค์กร";

  return (
    <Page width="form">
      <PageHeader
        descriptionTestId="settings-description"
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
        eyebrow="// account settings"
        title="การตั้งค่าส่วนตัว"
        description={
          activeOrg === null
            ? scope
            : `${scope} ไม่ใช่การตั้งค่าขององค์กร ${activeOrg.name}`
        }
      />

      <div className="border-b border-foreground/10">
        <nav
          data-testid="settings-tabs"
          aria-label="หมวดการตั้งค่า"
          className="-mb-px flex flex-wrap gap-x-2"
        >
          {SETTINGS_TABS.map((tab) => {
            const Icon = NAV_ICONS[tab.icon];
            const active = isActiveTab(tab.path, pathname);
            return (
              <NavLink
                key={tab.path}
                data-testid={`settings-tab-${tab.path}`}
                to={tab.path}
                className={`inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
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

      <div data-testid="settings-panel" className="min-w-0">
        <Outlet />
      </div>
    </Page>
  );
}
