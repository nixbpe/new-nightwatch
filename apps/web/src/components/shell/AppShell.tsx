import { useEffect, useState } from "react";
import { Outlet } from "react-router";

import { Header } from "./Header";
import { PanelLeftIcon, XIcon } from "./icons";
import { Sidebar } from "./Sidebar";

/**
 * App shell — Step 1 (layout) + Step 2 (sidebar) + Step 3 (header): header
 * (logo/breadcrumb/search & notification placeholders/avatar dropdown —
 * see Header.tsx), config-driven sidebar (collapsible, mobile drawer below
 * `sm`), scrollable main, footer. Existing design-system tokens only.
 */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Escape closes the mobile drawer, matching the design system's overlay
  // dismissal rule (docs/design-system.md: "Clear title, dismissal and
  // return path").
  useEffect(() => {
    if (!mobileOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        onOpenMobileMenu={() => {
          setMobileOpen(true);
        }}
      />
      <div className="flex flex-1">
        <aside
          className={`hidden flex-shrink-0 flex-col border-r border-control-border/40 bg-surface py-3 sm:flex ${
            collapsed ? "w-14" : "w-56"
          }`}
        >
          <div className={`mb-2 px-2 ${collapsed ? "" : "flex justify-end"}`}>
            <button
              type="button"
              aria-label={collapsed ? "ขยายเมนู" : "ย่อเมนู"}
              aria-expanded={!collapsed}
              onClick={() => {
                setCollapsed((value) => !value);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground-secondary hover:bg-background hover:text-foreground"
            >
              <PanelLeftIcon size={16} />
            </button>
          </div>
          <Sidebar collapsed={collapsed} />
        </aside>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 sm:hidden">
            <button
              type="button"
              aria-label="ปิดเมนู"
              onClick={() => {
                setMobileOpen(false);
              }}
              className="absolute inset-0 bg-foreground/40"
            />
            <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface py-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between px-3">
                <span className="text-sm font-semibold">เมนู</span>
                <button
                  type="button"
                  aria-label="ปิดเมนู"
                  onClick={() => {
                    setMobileOpen(false);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground-secondary hover:bg-background hover:text-foreground"
                >
                  <XIcon size={16} />
                </button>
              </div>
              <Sidebar
                collapsed={false}
                onNavigate={() => {
                  setMobileOpen(false);
                }}
              />
            </div>
          </div>
        ) : null}

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-4 py-8">
            <Outlet />
          </div>
        </main>
      </div>
      <footer className="flex-shrink-0 border-t border-control-border/40 bg-surface px-4 py-3 text-xs text-foreground-secondary">
        © NightWatch
      </footer>
    </div>
  );
}
