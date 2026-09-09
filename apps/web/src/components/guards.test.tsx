import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, Suspense, lazy } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearReturnTo,
  readInvitation,
  readReturnTo,
  rememberInvitation,
  rememberReturnTo,
} from "../lib/auth/continuation";
import { SessionQueryProvider } from "../lib/auth/SessionQueryProvider";

import { RequireAnon, RequireAuth, RequireVerified } from "./guards";

type SessionUser = {
  id: string;
  email: string;
  emailVerified: boolean;
};

const { sessionState } = vi.hoisted(() => ({
  sessionState: {
    data: null as { user: SessionUser } | null,
    isPending: false,
    refetch: vi.fn(),
  },
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

const VERIFIED: SessionUser = {
  id: "user-1",
  email: "member@example.com",
  emailVerified: true,
};

const UNVERIFIED: SessionUser = {
  id: "user-2",
  email: "new@example.com",
  emailVerified: false,
};

/** Reports the landed route plus any remembered navigation state. */
function LocationProbe() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "none";
  return (
    <div>
      <div data-testid="location">{location.pathname}</div>
      <div data-testid="from">{from}</div>
    </div>
  );
}

function renderAt(entry: string | { pathname: string }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth>
              <div>root-area</div>
            </RequireAuth>
          }
        />
        <Route
          path="/guarded"
          element={
            <RequireAuth>
              <div>protected-area</div>
            </RequireAuth>
          }
        />
        <Route
          path="/verified-only"
          element={
            <RequireVerified>
              <div>verified-area</div>
            </RequireVerified>
          }
        />
        <Route
          path="/anon-only"
          element={
            <RequireAnon>
              <div>anon-area</div>
            </RequireAnon>
          }
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionState.isPending = false;
    sessionState.refetch.mockReset();
  });

  it("holds protected content while the session is still loading", () => {
    sessionState.isPending = true;
    renderAt("/guarded");

    expect(screen.getByRole("status")).toHaveTextContent("กำลังตรวจสอบเซสชัน…");
    expect(screen.queryByText("protected-area")).toBeNull();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("bounces anonymous visitors to login remembering the deep link", async () => {
    renderAt("/guarded?tab=security");

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    // The intended destination survives the round trip, query included.
    expect(screen.getByTestId("from")).toHaveTextContent(
      "/guarded?tab=security",
    );
    expect(screen.queryByText("protected-area")).toBeNull();
  });

  it("remembers /workspace instead of the bare root bounce target", async () => {
    // "/" itself redirects to /workspace; remembering "/" would loop the
    // login continuation back onto the bounce.
    renderAt("/");

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(screen.getByTestId("from")).toHaveTextContent("/workspace");
  });

  it("renders protected content for an authenticated session", () => {
    sessionState.data = { user: VERIFIED };
    renderAt("/guarded");

    expect(screen.getByText("protected-area")).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
  });
});

describe("RequireVerified", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionState.isPending = false;
    sessionState.refetch.mockReset();
  });

  it("renders content immediately for a verified session", () => {
    sessionState.data = { user: VERIFIED };
    renderAt("/verified-only");

    expect(screen.getByText("verified-area")).toBeInTheDocument();
    expect(sessionState.refetch).not.toHaveBeenCalled();
  });

  it("forces exactly one session recheck before bouncing the unverified", async () => {
    // The session snapshot can be stale right after the verification
    // callback; the guard refetches once, then routes to the resend hub —
    // a missing recheck flag would loop the effect forever.
    sessionState.refetch.mockResolvedValue(undefined);
    sessionState.data = { user: UNVERIFIED };
    renderAt("/verified-only");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/verify-email",
    );
    expect(screen.queryByText("verified-area")).toBeNull();
    await waitFor(() => {
      expect(sessionState.refetch).toHaveBeenCalledTimes(1);
    });
  });

  it("admits a session whose forced recheck proves verified", async () => {
    // Stale snapshot: the refetch observes the verification that landed
    // after the snapshot was taken, so the user is never bounced.
    sessionState.refetch.mockImplementation(() => {
      sessionState.data = { user: { ...UNVERIFIED, emailVerified: true } };
      return Promise.resolve(undefined);
    });
    sessionState.data = { user: UNVERIFIED };
    renderAt("/verified-only");

    expect(await screen.findByText("verified-area")).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
  });
});

describe("RequireAnon", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionState.isPending = false;
    sessionState.refetch.mockReset();
    sessionStorage.clear();
  });

  it("holds anonymous pages while the session is still loading", () => {
    sessionState.isPending = true;
    renderAt("/anon-only");

    expect(screen.getByRole("status")).toHaveTextContent("กำลังตรวจสอบเซสชัน…");
    expect(screen.queryByText("anon-area")).toBeNull();
  });

  it("keeps signed-in users out of anonymous-only pages", async () => {
    sessionState.data = { user: VERIFIED };
    renderAt("/anon-only");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace",
    );
    expect(screen.queryByText("anon-area")).toBeNull();
  });

  it("renders anonymous content for visitors without a session", () => {
    renderAt("/anon-only");

    expect(screen.getByText("anon-area")).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("preserves the return through abandoned StrictMode renders, then consumes it only for the committed redirect", async () => {
    sessionState.data = { user: VERIFIED };
    rememberReturnTo("/settings/security?tab=sessions#current");
    const gate = Promise.withResolvers<{ default: () => null }>();
    const RenderGate = lazy(() => gate.promise);

    function Destination() {
      const location = useLocation();
      return (
        <>
          <div data-testid="destination">
            {location.pathname + location.search + location.hash}
          </div>
          <Link to="/anon-only">Return to login</Link>
        </>
      );
    }

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/anon-only"]}>
          <SessionQueryProvider>
            <Routes>
              <Route
                path="/anon-only"
                element={
                  <Suspense fallback={<div>Waiting to commit</div>}>
                    <RequireAnon>
                      <div>anonymous page</div>
                    </RequireAnon>
                    <RenderGate />
                  </Suspense>
                }
              />
              <Route path="*" element={<Destination />} />
            </Routes>
          </SessionQueryProvider>
        </MemoryRouter>
      </StrictMode>,
    );

    // The redirect rendered, but its Suspense boundary did not commit.
    expect(screen.getByText("Waiting to commit")).toBeInTheDocument();
    expect(readReturnTo()).toBe("/settings/security?tab=sessions#current");
    expect(readReturnTo()).toBe("/settings/security?tab=sessions#current");
    expect(screen.queryByTestId("destination")).toBeNull();

    await act(async () => {
      gate.resolve({ default: () => null });
      await gate.promise;
    });

    expect(await screen.findByTestId("destination")).toHaveTextContent(
      "/settings/security?tab=sessions#current",
    );
    expect(readReturnTo()).toBe("/workspace");

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Return to login" }));
    expect(await screen.findByTestId("destination")).toHaveTextContent(
      "/workspace",
    );
    expect(screen.queryByText("anonymous page")).toBeNull();
  });

  it("explicitly clearing the return does not consume a pending invitation", () => {
    rememberInvitation("inv-still-pending");
    rememberReturnTo("/settings/security");

    expect(readReturnTo()).toBe("/settings/security");
    expect(readReturnTo()).toBe("/settings/security");
    clearReturnTo();

    expect(readReturnTo()).toBe("/workspace");
    expect(readInvitation()).toBe("inv-still-pending");
  });
});
