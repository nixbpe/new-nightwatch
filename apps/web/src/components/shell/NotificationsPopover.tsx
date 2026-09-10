import { EmptyState } from "./EmptyState";
import { BellIcon, SlidersIcon } from "./icons";
import { usePopover } from "./usePopover";

/**
 * Header notifications panel, per the reference — title row, list area,
 * footer actions. There is no notification source yet, so the list is an
 * honest empty state (never sample items or a fake unread badge; the
 * design system forbids demonstrations that read as live data), and the
 * actions that would act on real items are disabled rather than dead.
 */
export function NotificationsPopover() {
  const popover = usePopover();
  return (
    <div className="relative">
      <button
        ref={popover.triggerRef}
        type="button"
        aria-label="การแจ้งเตือน"
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        onClick={popover.toggle}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground-secondary hover:bg-foreground/5 hover:text-foreground"
      >
        <BellIcon size={18} />
      </button>
      {popover.open ? (
        <div
          ref={popover.panelRef}
          role="dialog"
          aria-label="การแจ้งเตือน"
          tabIndex={-1}
          className="absolute top-full right-0 z-50 mt-2 w-[380px] max-w-[calc(100vw-2rem)] rounded-md border border-foreground/10 bg-surface shadow-lg focus:outline-none"
        >
          <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3">
            <h2 className="text-sm font-semibold">การแจ้งเตือน</h2>
            <button
              type="button"
              disabled
              className="text-xs text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              ทำเครื่องหมายว่าอ่านทั้งหมด
            </button>
          </div>
          <div className="p-3">
            <EmptyState
              icon={<BellIcon size={20} />}
              title="ยังไม่มีการแจ้งเตือน"
              description="เมื่อมีเหตุการณ์ในองค์กรของคุณ การแจ้งเตือนจะแสดงที่นี่"
            />
          </div>
          <div className="flex items-center justify-between border-t border-foreground/10 px-4 py-2.5 text-xs">
            <button
              type="button"
              disabled
              className="text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              ดูการแจ้งเตือนทั้งหมด
            </button>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1.5 text-foreground-secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <SlidersIcon size={14} />
              ตั้งค่า
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
