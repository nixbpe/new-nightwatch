import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import { useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  peekStagedQueryClient,
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

// Records every committed frame: an effect-phase client swap would show the new identity
// against the old cache for one frame, which a post-hoc DOM assertion could miss.
const commitLog: string[] = [];

// Stands in for TenantProvider's /me query; reads only through the provider's QueryClient.
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
    // A loader of the initial URL prefetched into the staged client before the first render.
    resolveQueryClientForIdentity("user-a").setQueryData(["me", "context"], {
      org: "Org A",
    });
    transport.mockImplementation(() => new Promise<{ org: string }>(() => {}));

    render(<Harness userId="user-a" pending={false} />);

    expect(await screen.findByText("Org A")).toBeInTheDocument();
    // Cache hit on the staged prefetch: the tree never re-fetched.
    expect(transport).not.toHaveBeenCalled();
  });

  it("adopts a client staged by a loader running ahead of the identity swap", async () => {
    // Login flow: B's loader prefetched before the provider committed B.
    transport.mockImplementationOnce(() => Promise.resolve({ org: "Org A" }));
    transport.mockImplementation(() => new Promise<{ org: string }>(() => {}));

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

  it("never relabels a loader-staged client when hydration resolves a different identity", async () => {
    // Loader/session race: the initial loader staged A's prefetch but the session resolves to B.
    const stagedClient = resolveQueryClientForIdentity("user-a");
    stagedClient.setQueryData(["me", "context"], { org: "Org A" });
    const cancelSpy = vi.spyOn(stagedClient, "cancelQueries");
    const clearSpy = vi.spyOn(stagedClient, "clear");
    transport.mockImplementation(() => Promise.resolve({ org: "Org B" }));

    render(<Harness userId="user-b" pending={false} />);

    // (a) B's tree never receives A's cached payload — not even one frame.
    expect(await screen.findByText("Org B")).toBeInTheDocument();
    expect(commitLog).not.toContain("Org A");
    // (b) The mismatched client is retired through the cancel-then-clear path.
    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalled();
      expect(clearSpy).toHaveBeenCalled();
    });
    // (c) The registry never serves A's client as B's, and A's staged slot is gone.
    const activeForB = resolveQueryClientForIdentity("user-b");
    expect(activeForB).not.toBe(stagedClient);
    expect(activeForB.getQueryData(["me", "context"])).toEqual({
      org: "Org B",
    });
    expect(peekStagedQueryClient()?.client).not.toBe(stagedClient);
  });

  it("initial hydration keeps the in-flight context query", async () => {
    // Hard reload: the session resolves after the /me query mounted; treating that as a user
    // switch would cancel the fresh query and strand the page on loading.
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
    // A's late /me response (same query key) must never surface in B's view.
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

  it("never renders the previous account cache after a direct account switch", async () => {
    // A→B flips in one step with no logged-out frame; only a commit observer can catch an
    // effect-phase swap here.
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
