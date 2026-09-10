import { useQuery } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetQueryClientRegistry,
  resolveQueryClientForIdentity,
} from "../queryClient";
import { SessionQueryProvider } from "./SessionQueryProvider";

const { sessionState, transport } = vi.hoisted(() => ({
  sessionState: {
    data: null as { user: { id: string } } | null,
    isPending: true,
  },
  transport: vi.fn<() => Promise<{ org: string }>>(),
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

/**
 * Every committed frame, in order. A layout effect observes exactly what
 * users could see; an effect-phase client swap would commit the new
 * identity against the old cache for one frame, which a post-hoc DOM
 * assertion alone could miss.
 */
const commitLog: string[] = [];

/**
 * Stands in for the tenant context consumer (TenantProvider's /me query):
 * reads its data through the provider-supplied QueryClient only.
 */
function ContextProbe() {
  const query = useQuery<{ org: string }>({
    queryKey: ["me", "context"],
    queryFn: () => transport(),
    retry: false,
  });
  const view = query.data === undefined ? "loading" : query.data.org;
  useLayoutEffect(() => {
    commitLog.push(view);
  });
  return <div data-testid="view">{view}</div>;
}

/** Mirrors the app shell: session state changes re-render the provider. */
function Harness({
  userId,
  pending,
}: {
  userId: string | null;
  pending: boolean;
}) {
  sessionState.isPending = pending;
  sessionState.data = userId === null ? null : { user: { id: userId } };
  return (
    <SessionQueryProvider>
      <ContextProbe />
    </SessionQueryProvider>
  );
}

describe("SessionQueryProvider identity boundaries", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionState.isPending = true;
    transport.mockReset();
    commitLog.length = 0;
    resetQueryClientRegistry();
  });

  it("adopts a loader-staged client on hydration so the prefetch survives (data mode)", async () => {
    // A loader of the initial URL prefetched into the staged client before
    // the first render; the boundary must start from exactly that client.
    resolveQueryClientForIdentity("user-a").setQueryData(["me", "context"], {
      org: "Org A",
    });
    transport.mockImplementation(
      () => new Promise<{ org: string }>(() => {}),
    );

    render(<Harness userId="user-a" pending={false} />);

    expect(await screen.findByText("Org A")).toBeInTheDocument();
    // Cache hit on the staged prefetch: the tree never re-fetched.
    expect(transport).not.toHaveBeenCalled();
  });

  it("adopts a client staged by a loader running ahead of the identity swap", async () => {
    // Login flow: B's loader prefetched before the provider committed B.
    transport.mockImplementationOnce(() => Promise.resolve({ org: "Org A" }));
    transport.mockImplementation(
      () => new Promise<{ org: string }>(() => {}),
    );

    const tree = render(<Harness userId="user-a" pending={false} />);
    expect(await screen.findByText("Org A")).toBeInTheDocument();

    resolveQueryClientForIdentity("user-b").setQueryData(["me", "context"], {
      org: "Org B",
    });
    tree.rerender(<Harness userId="user-b" pending={false} />);

    expect(await screen.findByText("Org B")).toBeInTheDocument();
    // B's tree consumed the staged prefetch instead of fetching again.
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("initial hydration keeps the in-flight context query (QA-12)", async () => {
    // Hard reload: the session resolves after the tree (and its /me query)
    // has already mounted. Treating that first resolution as a user switch
    // cancels/clears the fresh query and strands the page on loading.
    const first = Promise.withResolvers<{ org: string }>();
    transport.mockImplementationOnce(() => first.promise);
    // If hydration wrongly re-issues the query, the retry never resolves.
    transport.mockImplementation(() => new Promise<{ org: string }>(() => {}));

    const tree = render(<Harness userId={null} pending={true} />);
    expect(screen.getByTestId("view")).toHaveTextContent("loading");

    // The session resolves to a user: initial hydration, not a switch.
    tree.rerender(<Harness userId="user-a" pending={false} />);

    first.resolve({ org: "Org A" });
    expect(await screen.findByText("Org A")).toBeInTheDocument();
    // The mounted query was never re-issued across hydration.
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("a late response from the signed-out identity never reaches the next user", async () => {
    // User A signs out and user B signs in before A's /me response lands.
    // The retired identity's cache must be dead: A's late data can never
    // surface in B's view (same query key, different identity).
    const staleA = Promise.withResolvers<{ org: string }>();
    transport.mockImplementationOnce(() => staleA.promise);
    transport.mockImplementation(() => Promise.resolve({ org: "Org B" }));

    const tree = render(<Harness userId="user-a" pending={false} />);
    expect(screen.getByTestId("view")).toHaveTextContent("loading");

    // A logs out, B logs in — before A's response arrives.
    tree.rerender(<Harness userId={null} pending={false} />);
    tree.rerender(<Harness userId="user-b" pending={false} />);

    expect(await screen.findByText("Org B")).toBeInTheDocument();

    // A's response finally lands; B's view must not flinch.
    await act(async () => {
      staleA.resolve({ org: "Org A" });
      await staleA.promise;
    });
    expect(screen.getByTestId("view")).toHaveTextContent("Org B");
    expect(screen.queryByText("Org A")).toBeNull();
  });

  it("a direct A→B account switch never commits a frame with A's cached data", async () => {
    // No logged-out intermediate: the resolved identity flips A→B in one
    // step. An effect-phase client swap would commit B's first frame
    // against A's cache — observable only via a commit observer.
    transport.mockImplementationOnce(() => Promise.resolve({ org: "Org A" }));
    transport.mockImplementation(() => Promise.resolve({ org: "Org B" }));

    const tree = render(<Harness userId="user-a" pending={false} />);
    expect(await screen.findByText("Org A")).toBeInTheDocument();
    // Boundary between A's committed frames and whatever B commits.
    const aCommits = commitLog.length;

    tree.rerender(<Harness userId="user-b" pending={false} />);

    expect(await screen.findByText("Org B")).toBeInTheDocument();
    // B's very first committed frame was already served by B's own client:
    // no frame after the switch ever showed A's data.
    expect(commitLog.slice(aCommits)).not.toContain("Org A");
    expect(commitLog.slice(aCommits)).toContain("loading");
  });
});
