import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";

import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  notificationQueryKey,
  openNotification,
} from "../../lib/api/notifications";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { NotificationRows } from "../../pages/NotificationsPage";
import { BellIcon, SlidersIcon } from "./icons";
import { usePopover } from "./usePopover";

export function NotificationsPopover() {
  const popover = usePopover();
  const { serverActiveOrgId, activeOrg } = useTenant();
  const navigate = useNavigate();
  const client = useQueryClient();
  const list = useQuery({
    queryKey: notificationQueryKey(serverActiveOrgId),
    queryFn: () => fetchNotifications(serverActiveOrgId),
    enabled: popover.open,
  });
  const count = useQuery({
    queryKey: [...notificationQueryKey(serverActiveOrgId), "count"],
    queryFn: () => fetchUnreadCount(serverActiveOrgId),
  });
  const all = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: notificationQueryKey(serverActiveOrgId),
      });
    },
  });
  const open = useMutation({
    mutationFn: openNotification,
    onSuccess: async (value) => {
      await client.invalidateQueries({
        queryKey: notificationQueryKey(serverActiveOrgId),
      });
      popover.close();
      void navigate("/notifications", {
        state: {
          notificationId: value.id,
          notificationOrganizationId: serverActiveOrgId,
          notificationScope: value.scope,
        },
      });
    },
  });
  return (
    <div className="relative">
      <button
        ref={popover.triggerRef}
        type="button"
        aria-label="การแจ้งเตือน"
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        onClick={popover.toggle}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground-secondary hover:bg-foreground/5 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <BellIcon size={18} />
        {count.data?.unreadCount ? (
          <span
            aria-label={`${String(count.data.unreadCount)} รายการยังไม่อ่าน`}
            className="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-[10px] text-on-primary"
          >
            {count.data.unreadCount}
          </span>
        ) : null}
      </button>
      {popover.open ? (
        <div
          ref={popover.panelRef}
          role="dialog"
          aria-label="การแจ้งเตือน"
          tabIndex={-1}
          className="fixed inset-4 z-50 mx-auto flex w-auto max-w-[380px] flex-col overflow-hidden rounded-md border border-foreground/10 bg-surface shadow-lg focus:outline-none sm:absolute sm:inset-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[380px] sm:max-w-[calc(100vw-2rem)] sm:max-h-[calc(100vh-5rem)]"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-4 py-3">
            <h2 className="text-sm font-semibold">การแจ้งเตือน</h2>
            <button
              type="button"
              data-popover-item=""
              disabled={
                count.data === undefined ||
                count.data.unreadCount === 0 ||
                all.isPending
              }
              onClick={() => {
                all.mutate();
              }}
              className="text-xs text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              ทำเครื่องหมายว่าอ่านทั้งหมด
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.isPending ? (
              <p
                role="status"
                className="p-4 text-sm text-foreground-secondary"
              >
                กำลังโหลด…
              </p>
            ) : list.isError ? (
              <p role="alert" className="p-4 text-sm text-danger">
                โหลดการแจ้งเตือนไม่สำเร็จ
              </p>
            ) : list.data.items.length === 0 ? (
              <p className="p-6 text-center text-sm text-foreground-secondary">
                ยังไม่มีการแจ้งเตือน
              </p>
            ) : (
              <NotificationRows
                items={list.data.items.slice(0, 5)}
                onOpen={(id) => {
                  open.mutate(id);
                }}
                popoverItems
              />
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-foreground/10 px-4 py-2.5 text-xs">
            <Link
              onClick={popover.close}
              data-popover-item=""
              to="/notifications"
              className="text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              ดูการแจ้งเตือนทั้งหมด
            </Link>
            {activeOrg?.role === "owner" || activeOrg?.role === "admin" ? (
              <Link
                onClick={popover.close}
                data-popover-item=""
                to={`/organizations/${activeOrg.id}/notification-settings`}
                className="inline-flex items-center gap-1.5 text-foreground-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <SlidersIcon size={14} />
                ตั้งค่า
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
