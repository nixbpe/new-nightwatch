import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";

import { ErrorBoundary } from "../ErrorBoundary";
import { CommandPalette } from "./CommandPalette";
import { Header } from "./Header";
import { XIcon } from "./icons";
import { Sidebar } from "./Sidebar";
import { useMediaQuery } from "./useMediaQuery";

/**
 * Authenticated app shell, per the reference: a full-height sidebar
 * (expanded at `lg`+, an icon rail below that, a drawer below `sm`) beside
 * a column of header + scrollable main. The shared ErrorBoundary is scoped
 * to the routed content so a crashing page leaves the chrome usable. The
 * header toggle overrides the breakpoint default until the breakpoint
 * itself changes, so resizing never leaves a stale override behind.
 */
export function AppShell() {
  const isLarge = useMediaQuery("(min-width: 1024px)", true);
  const [override, setOverride] = useState<{
    collapsed: boolean;
    forLarge: boolean;
  } | null>(null);
  const collapsed =
    override !== null && override.forLarge === isLarge
      ? override.collapsed
      : !isLarge;

  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

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
    <div className="flex h-dvh">
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-on-primary"
      >
        ข้ามไปที่เนื้อหาหลัก
      </a>

      <aside
        id="app-sidebar"
        className={`hidden flex-shrink-0 border-r border-foreground/10 bg-surface sm:block ${
          collapsed ? "w-14" : "w-60"
        }`}
      >
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
          <div className="absolute inset-y-0 left-0 w-64 bg-surface shadow-lg">
            <button
              ref={mobileCloseButtonRef}
              type="button"
              aria-label="ปิดเมนู"
              onClick={closeMobileMenu}
              className="absolute top-2 -right-11 inline-flex h-9 w-9 items-center justify-center rounded-md bg-surface text-foreground-secondary hover:text-foreground"
            >
              <XIcon size={18} />
            </button>
            <Sidebar collapsed={false} onNavigate={closeMobileMenu} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          collapsed={collapsed}
          onToggleSidebar={() => {
            setOverride({ collapsed: !collapsed, forLarge: isLarge });
          }}
          onOpenMobileMenu={() => {
            setMobileOpen(true);
          }}
          mobileMenuButtonRef={mobileMenuButtonRef}
          onOpenSearch={() => {
            setSearchOpen(true);
          }}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto focus:outline-none"
        >
          <div className="flex min-h-full flex-col">
            <div className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </div>
            <footer className="px-4 py-3 text-xs text-foreground-secondary sm:px-8">
              © NightWatch
            </footer>
          </div>
        </main>
      </div>

      {searchOpen ? (
        <CommandPalette
          onClose={() => {
            setSearchOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
