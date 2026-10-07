import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";

import {
  fetchNotifications,
  markAllNotificationsRead,
  notificationQueryKey,
  openNotification,
} from "../../lib/api/notifications";
import {
  getContextPublicationSnapshot,
  getQueryClientIdentity,
  type ContextPublicationSnapshot,
} from "../../lib/queryClient";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { NotificationRows } from "../../pages/NotificationsPage";
import { BellIcon, SlidersIcon } from "./icons";
import { Skeleton } from "./Skeleton";
import { useUnreadCount } from "./useNavCounts";
import { usePopover } from "./usePopover";

export function NotificationsPopover() {
  const popover = usePopover();
  const { me, mePending, meError, retryMe, serverActiveOrgId, activeOrg } =
    useTenant();
  const navigate = useNavigate();
  const client = useQueryClient();
  const list = useQuery({
    queryKey: notificationQueryKey(serverActiveOrgId),
    queryFn: () => fetchNotifications(serverActiveOrgId),
    enabled: popover.open && me !== undefined,
  });
  const count = useUnreadCount();
  type Binding = Readonly<
    Pick<
      ContextPublicationSnapshot,
      "requiredGeneration" | "publishedClaim"
    > & { identity: string }
  >;
  type OpenCommand = Readonly<{
    id: string;
    organizationId: string | null;
    binding: Binding;
  }>;
  type ReadAllCommand = Readonly<{
    expectedOrganizationId: string | null;
    binding: Binding;
  }>;
  const latestOpen = useRef<OpenCommand | null>(null);
  const latestAll = useRef<ReadAllCommand | null>(null);
  const owns = (binding: Binding) => {
    const current = getContextPublicationSnapshot(client);
    return (
      current.admission.kind === "confirmed" &&
      current.requiredGeneration === binding.requiredGeneration &&
      current.publishedClaim === binding.publishedClaim &&
      getQueryClientIdentity(client) === binding.identity
    );
  };
  const all = useMutation({
    meta: { notificationOperation: "read-all" },
    mutationFn: (command: ReadAllCommand) => {
      if (latestAll.current !== command || !owns(command.binding))
        throw new Error("Notification scope unavailable");
      return markAllNotificationsRead(command.expectedOrganizationId);
    },
    onSuccess: async (_value, command) => {
      if (latestAll.current !== command || !owns(command.binding)) return;
      await client.invalidateQueries({
        queryKey: notificationQueryKey(command.expectedOrganizationId),
      });
    },
  });
  const open = useMutation({
    mutationFn: (command: OpenCommand) => {
      if (latestOpen.current !== command || !owns(command.binding))
        throw new Error("Notification scope unavailable");
      return openNotification(command.id);
    },
    onSuccess: async (value, command) => {
      if (latestOpen.current !== command || !owns(command.binding)) return;
      await client.invalidateQueries({
        queryKey: notificationQueryKey(command.organizationId),
      });
      if (latestOpen.current !== command || !owns(command.binding)) return;
      popover.close();
      void navigate("/notifications", {
        state: {
          notificationId: value.id,
          notificationOrganizationId: command.organizationId,
          notificationScope: value.scope,
        },
      });
    },
  });
  const unreadCount =
    me === undefined
      ? undefined
      : count.isError
        ? list.data?.unreadCount
        : count.data?.unreadCount;
  return (
    <div className="relative">
      <button
        ref={popover.triggerRef}
        type="button"
        aria-label="การแจ้งเตือน"
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        disabled={me === undefined}
        onClick={() => {
          latestOpen.current = null;
          latestAll.current = null;
          open.reset();
          all.reset();
          popover.toggle();
        }}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-control-border text-foreground-secondary hover:surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <BellIcon size={18} />
        {unreadCount ? (
          <span
            aria-label={`${String(unreadCount)} รายการยังไม่อ่าน`}
            // A Text-filled counter: the count is a fact, not a status colour.
            className="absolute -top-[7px] -right-[7px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-foreground px-[5px] font-mono text-[11px] leading-none font-semibold text-background"
          >
            {unreadCount}
          </span>
        ) : null}
      </button>
      {popover.open ? (
        <div
          ref={popover.panelRef}
          role="dialog"
          aria-label="การแจ้งเตือน"
          tabIndex={-1}
          className="overlay-enter fixed inset-4 z-50 mx-auto flex w-auto max-w-[380px] flex-col overflow-hidden rounded-md border border-foreground/10 bg-surface shadow-lg focus:outline-none sm:absolute sm:inset-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[380px] sm:max-w-[calc(100vw-2rem)] sm:max-h-[calc(100vh-5rem)]"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-4 py-3">
            <h2 className="text-sm font-semibold">การแจ้งเตือน</h2>
            <button
              type="button"
              data-popover-item=""
              disabled={
                me === undefined ||
                unreadCount === undefined ||
                unreadCount === 0 ||
                all.isPending
              }
              onClick={() => {
                const publication = getContextPublicationSnapshot(client);
                const admission = publication.admission;
                if (admission.kind !== "confirmed" || admission.context !== me)
                  return;
                const command: ReadAllCommand = {
                  expectedOrganizationId: serverActiveOrgId,
                  binding: {
                    requiredGeneration: publication.requiredGeneration,
                    publishedClaim: publication.publishedClaim,
                    identity: admission.context.user.id,
                  },
                };
                latestAll.current = command;
                all.mutate(command);
              }}
              className="text-xs text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              ทำเครื่องหมายว่าอ่านทั้งหมด
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {open.isError || all.isError ? (
              <p
                role="alert"
                className="border-b border-foreground/10 px-4 py-3 text-sm text-danger"
              >
                {open.isError
                  ? "เปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
                  : "ทำเครื่องหมายว่าอ่านทั้งหมดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"}
              </p>
            ) : null}
            {meError !== null ? (
              <div className="p-4 text-sm">
                <p role="alert" className="text-danger">
                  โหลดการแจ้งเตือนไม่สำเร็จ
                </p>
                <button
                  type="button"
                  data-popover-item=""
                  onClick={() => {
                    void retryMe();
                  }}
                  className="mt-2 text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  ลองใหม่
                </button>
              </div>
            ) : mePending || me === undefined || list.isPending ? (
              <div role="status" className="divide-y divide-foreground/10">
                <span className="sr-only">กำลังโหลด…</span>
                {[0, 1].map((row) => (
                  <div key={row} className="flex gap-3 px-4 py-3">
                    <Skeleton className="ml-5 h-8 w-8 shrink-0" />
                    <span className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-48 max-w-full" />
                      <Skeleton className="h-3 w-32" />
                    </span>
                  </div>
                ))}
              </div>
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
                  const admission =
                    getContextPublicationSnapshot(client).admission;
                  if (
                    admission.kind !== "confirmed" ||
                    admission.context !== me ||
                    open.isPending
                  )
                    return;
                  const publication = getContextPublicationSnapshot(client);
                  const command: OpenCommand = {
                    id,
                    organizationId: serverActiveOrgId,
                    binding: {
                      requiredGeneration: publication.requiredGeneration,
                      publishedClaim: publication.publishedClaim,
                      identity: admission.context.user.id,
                    },
                  };
                  latestOpen.current = command;
                  open.mutate(command);
                }}
                onNavigate={popover.close}
                popoverItems
              />
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-foreground/10 px-4 py-2.5 text-xs">
            {me === undefined ? (
              <span className="text-foreground-tertiary">
                ดูการแจ้งเตือนทั้งหมด
              </span>
            ) : (
              <Link
                onClick={popover.close}
                data-popover-item=""
                to="/notifications"
                className="text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                ดูการแจ้งเตือนทั้งหมด
              </Link>
            )}
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
