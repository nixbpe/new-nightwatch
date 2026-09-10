import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";

const { sessionState } = vi.hoisted(() => ({
  sessionState: {
    data: { user: { email: "shell@example.com" } },
    isPending: false,
  },
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    signOut: vi.fn(),
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

function ThrowingPage(): never {
  throw new Error("boom");
}

function renderShell(pageElement: ReactNode) {
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [{ path: "/workspace", element: pageElement }],
      },
    ],
    { initialEntries: ["/workspace"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("AppShell", () => {
  it("renders the header, sidebar nav, skip link and routed content together", () => {
    renderShell(<p>เนื้อหาหน้า</p>);

    expect(screen.getByText("NightWatch")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ข้ามไปที่เนื้อหาหลัก" }),
    ).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("link", { name: "ภาพรวม" })).toHaveAttribute(
      "href",
      "/workspace",
    );
    expect(screen.getByText("เนื้อหาหน้า")).toBeInTheDocument();
  });

  it("a crashing page is caught without losing the header/sidebar chrome", () => {
    // The boundary logs the caught error to console.error by design
    // (ErrorBoundary.componentDidCatch); silence it so this expected
    // failure doesn't read as a real test problem.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderShell(<ThrowingPage />);

    // Shell chrome survives — the user can still navigate away.
    expect(screen.getByText("NightWatch")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ภาพรวม" })).toBeInTheDocument();
    // The routed content is replaced by the boundary's fallback, not the
    // header/sidebar.
    expect(screen.getByRole("alert")).toHaveTextContent("boom");

    consoleError.mockRestore();
  });

  it("opening the avatar menu moves focus to its first enabled item", async () => {
    const user = userEvent.setup();
    renderShell(<p>เนื้อหาหน้า</p>);

    await user.click(screen.getByRole("button", { name: "เมนูบัญชีผู้ใช้" }));

    expect(
      screen.getByRole("menuitem", { name: "ตั้งค่าความปลอดภัย" }),
    ).toHaveFocus();
  });
});
