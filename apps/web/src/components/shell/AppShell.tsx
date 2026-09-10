import type { ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";

import { authClient } from "../../lib/auth-client";

/**
 * App shell — Step 1 (layout only): header, sidebar, scrollable main, footer.
 * Structure follows the reference AppShell design explored in
 * docs/ref/designs/; tokens/components are the existing design system
 * (Card/Button classes, --surface/--control-border/etc. from index.css) —
 * no new visual styles.
 *
 * This step keeps navigation minimal (a plain link list, session email and
 * sign-out relocated from WorkspacePage's old inline header) so the app
 * stays fully usable while later steps upgrade the sidebar to the
 * config-driven menu (Step 2) and the header to breadcrumb/search/
 * notification/avatar-dropdown (Step 3).
 */
export function AppShell() {
  const navigate = useNavigate();
  const { data } = authClient.useSession();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 flex-shrink-0 items-center gap-4 border-b border-control-border/40 bg-surface px-4">
        <span className="text-lg font-semibold">NightWatch</span>
        <div className="ms-auto flex items-center gap-4 text-sm">
          {data === null ? null : (
            <span className="text-foreground-secondary">{data.user.email}</span>
          )}
          <button
            type="button"
            className="text-foreground-secondary underline"
            onClick={() => {
              void authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    void navigate("/login", { replace: true });
                  },
                },
              });
            }}
          >
            ออกจากระบบ
          </button>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-56 flex-shrink-0 border-r border-control-border/40 bg-surface p-3 sm:block">
          <nav className="flex flex-col gap-1">
            <ShellNavLink to="/workspace">ภาพรวม</ShellNavLink>
            <ShellNavLink to="/settings/security">
              ความปลอดภัยบัญชี
            </ShellNavLink>
          </nav>
        </aside>
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

function ShellNavLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-md px-3 py-2 text-sm ${
          isActive
            ? "bg-background font-medium text-foreground"
            : "text-foreground-secondary hover:text-foreground"
        }`
      }
    >
      {children}
    </NavLink>
  );
}
