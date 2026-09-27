import { useLocation, useNavigate } from "react-router";

import { ROLE_LABELS } from "../../lib/roles";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { BrandMark } from "./BrandMark";
import { CheckIcon, ChevronsUpDownIcon } from "./icons";
import { initialsOf } from "./initials";
import { Skeleton } from "./Skeleton";
import { usePopover } from "./usePopover";

// Falls back to the product mark with no membership or a failed context load; the page surfaces the error.
export function OrgSwitcher({ collapsed }: { collapsed: boolean }) {
  const { me, mePending, activeOrg, switchOrg, orgSwitchPending } = useTenant();
  const location = useLocation();
  const navigate = useNavigate();
  const popover = usePopover();

  if (mePending) {
    return (
      <div className="flex h-14 items-center gap-2.5 border-b border-foreground/10 px-4">
        <Skeleton className="h-8 w-8 flex-shrink-0" />
        {collapsed ? null : (
          <span className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </span>
        )}
      </div>
    );
  }

  if (activeOrg === null) {
    return (
      <div
        className={`flex h-14 items-center gap-2.5 border-b border-foreground/10 ${
          collapsed ? "justify-center px-2" : "px-4"
        }`}
      >
        <BrandMark withName={!collapsed} />
      </div>
    );
  }

  const memberships = me?.organizations ?? [];
  const canSwitch = memberships.length > 1;
  const roleLabel = ROLE_LABELS[activeOrg.role] ?? activeOrg.role;

  const content = (
    <>
      <OrgMark name={activeOrg.name} />
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1 text-start">
            <span className="block truncate text-sm font-medium text-foreground">
              {activeOrg.name}
            </span>
            <span className="block truncate text-xs text-foreground-secondary">
              องค์กร · {roleLabel}
            </span>
          </span>
          {canSwitch ? (
            <span className="text-foreground-secondary">
              <ChevronsUpDownIcon size={16} />
            </span>
          ) : null}
        </>
      )}
    </>
  );
  const blockClass = `flex h-10 w-full items-center gap-2.5 rounded-md ${
    collapsed ? "justify-center" : "px-2"
  }`;

  return (
    // h-14 like the header, so the two hairlines meet at the same y.
    <div className="relative flex h-14 items-center border-b border-foreground/10 px-2">
      {canSwitch ? (
        <button
          ref={popover.triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={popover.open}
          aria-label={collapsed ? `องค์กร: ${activeOrg.name}` : undefined}
          onClick={popover.toggle}
          className={`${blockClass} hover:bg-foreground/5`}
        >
          {content}
        </button>
      ) : (
        <div
          className={blockClass}
          aria-label={collapsed ? `องค์กร: ${activeOrg.name}` : undefined}
        >
          {content}
        </div>
      )}
      {popover.open ? (
        <div
          ref={popover.panelRef}
          role="menu"
          aria-label="สลับองค์กร"
          tabIndex={-1}
          className="absolute top-full left-2 z-50 mt-1 w-64 rounded-md border border-foreground/10 bg-surface p-1 shadow-lg focus:outline-none"
        >
          <p className="px-2.5 py-1.5 text-xs text-foreground-secondary">
            องค์กรของคุณ
          </p>
          {memberships.map((org) => {
            const active = org.id === activeOrg.id;
            return (
              <button
                key={org.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={orgSwitchPending}
                onClick={() => {
                  popover.close();
                  void switchOrg(org.id).then((switched) => {
                    if (
                      switched &&
                      /^\/organizations\/[^/]+\/members$/.test(
                        location.pathname,
                      )
                    ) {
                      navigate(`/organizations/${org.id}/members`, {
                        replace: true,
                      });
                    }
                  });
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <OrgMark name={org.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {org.name}
                  </span>
                  <span className="block truncate text-xs text-foreground-secondary">
                    {ROLE_LABELS[org.role] ?? org.role}
                  </span>
                </span>
                {active ? (
                  <span className="text-primary">
                    <CheckIcon size={16} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** A system object, so the 4px corner rather than a circle. */
function OrgMark({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-surface text-xs font-semibold text-foreground"
    >
      {initialsOf(name)}
    </span>
  );
}
