import { ROLE_LABELS } from "../../lib/roles";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { CheckIcon, ChevronsUpDownIcon, ShieldIcon } from "./icons";
import { initialsOf } from "./initials";
import { Skeleton } from "./Skeleton";
import { usePopover } from "./usePopover";

/**
 * Top of the sidebar, per the reference: the active organization's mark,
 * name and the user's role in it, opening a switcher over every
 * membership. This is the shell's "logo slot" — organization identity
 * when there is one, the product mark when the user has no membership
 * yet (or the context failed to load; the page surfaces that error).
 */
export function OrgSwitcher({ collapsed }: { collapsed: boolean }) {
  const { me, mePending, activeOrg, switchOrg, orgSwitchPending } = useTenant();
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
        <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary text-on-primary">
          <ShieldIcon size={16} />
        </span>
        {collapsed ? null : (
          <span className="text-sm font-semibold">NightWatch</span>
        )}
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
    <div className="relative border-b border-foreground/10 p-2">
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
                  void switchOrg(org.id);
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

/** Organization mark: system object, so the 4px corner rather than a circle. */
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
