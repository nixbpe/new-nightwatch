import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";

import { ErrorBoundary } from "../ErrorBoundary";
import { Header } from "./Header";
import { PanelLeftIcon, XIcon } from "./icons";
import { Sidebar } from "./Sidebar";

/**
 * App shell — Steps 1–3 (layout, sidebar, header) + Step 7 hardening: a
 * skip-to-content link, the shared ErrorBoundary scoped to just the routed
 * content (so header/sidebar/footer stay usable if a page crashes — the
 * app already had a global one in RootLayout for anything outside any
 * shell), and focus management for the mobile drawer (focus moves to its
 * close button on open and back to the button that opened it on close,
 * matching docs/design-system.md's overlay-dismissal rule).
 */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }
    mobileCloseButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        mobileMenuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  const closeMobileMenu = () => {
    setMobileOpen(false);
    mobileMenuButtonRef.current?.focus();
  };

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-on-primary"
      >
        ข้ามไปที่เนื้อหาหลัก
      </a>
      <Header
        onOpenMobileMenu={() => {
          setMobileOpen(true);
        }}
        mobileMenuButtonRef={mobileMenuButtonRef}
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
              onClick={closeMobileMenu}
              className="absolute inset-0 bg-foreground/40"
            />
            <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface py-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between px-3">
                <span className="text-sm font-semibold">เมนู</span>
                <button
                  ref={mobileCloseButtonRef}
                  type="button"
                  aria-label="ปิดเมนู"
                  onClick={closeMobileMenu}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground-secondary hover:bg-background hover:text-foreground"
                >
                  <XIcon size={16} />
                </button>
              </div>
              <Sidebar collapsed={false} onNavigate={closeMobileMenu} />
            </div>
          </div>
        ) : null}

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-y-auto focus:outline-none"
        >
          <div className="mx-auto max-w-5xl px-4 py-8">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <footer className="flex-shrink-0 border-t border-control-border/40 bg-surface px-4 py-3 text-xs text-foreground-secondary">
        © NightWatch
      </footer>
    </div>
  );
}
