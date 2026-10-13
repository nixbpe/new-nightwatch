import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  getLastProjectLandingRevision,
  trackLastProjectSave,
  waitForLastProjectSaves,
} from "./lastProjectSave";

const ORG = "11111111-1111-4111-8111-111111111111";

describe("last Project save barrier", () => {
  it("retains the scoped landing revision after completion", async () => {
    const client = new QueryClient();
    const before = getLastProjectLandingRevision(client, ORG);
    trackLastProjectSave(client, ORG, Promise.resolve());
    const current = getLastProjectLandingRevision(client, ORG);
    expect(current).not.toBe(before);
    await waitForLastProjectSaves(client, ORG, new AbortController().signal);
    expect(getLastProjectLandingRevision(client, ORG)).toBe(current);
    trackLastProjectSave(client, "other-org", Promise.resolve());
    expect(getLastProjectLandingRevision(client, ORG)).toBe(current);
    expect(
      getLastProjectLandingRevision(new QueryClient(), ORG),
    ).toBeUndefined();
  });
  it("waits for every concurrent save of the same client and Organization", async () => {
    const client = new QueryClient();
    const first = Promise.withResolvers<undefined>();
    const second = Promise.withResolvers<undefined>();
    trackLastProjectSave(client, ORG, first.promise);
    trackLastProjectSave(client, ORG, second.promise);
    const done = vi.fn();
    const waiting = waitForLastProjectSaves(
      client,
      ORG,
      new AbortController().signal,
    ).then(done);
    first.resolve(undefined);
    await first.promise;
    expect(done).not.toHaveBeenCalled();
    second.resolve(undefined);
    await waiting;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("includes the next save registered by the previous save's finally", async () => {
    const client = new QueryClient();
    const first = Promise.withResolvers<undefined>();
    const second = Promise.withResolvers<undefined>();
    const nextStarted = vi.fn();
    trackLastProjectSave(
      client,
      ORG,
      first.promise.finally(() => {
        trackLastProjectSave(client, ORG, second.promise);
        nextStarted();
      }),
    );
    const done = vi.fn();
    const waiting = waitForLastProjectSaves(
      client,
      ORG,
      new AbortController().signal,
    ).then(done);
    first.resolve(undefined);
    await vi.waitFor(() => {
      expect(nextStarted).toHaveBeenCalledTimes(1);
    });
    expect(done).not.toHaveBeenCalled();
    second.resolve(undefined);
    await waiting;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("releases a failed save without propagating its error", async () => {
    const client = new QueryClient();
    const save = Promise.withResolvers<undefined>();
    trackLastProjectSave(client, ORG, save.promise);
    const waiting = waitForLastProjectSaves(
      client,
      ORG,
      new AbortController().signal,
    );
    save.reject(new Error("save failed"));
    await expect(waiting).resolves.toBeUndefined();
  });

  it("does not wait on another identity's client or another Organization", async () => {
    const client = new QueryClient();
    const save = Promise.withResolvers<undefined>();
    trackLastProjectSave(client, ORG, save.promise);
    await expect(
      waitForLastProjectSaves(
        new QueryClient(),
        ORG,
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    await expect(
      waitForLastProjectSaves(
        client,
        "other-org",
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    save.resolve(undefined);
  });

  it("aborts the wait without retiring the pending save and removes its listener", async () => {
    const client = new QueryClient();
    const save = Promise.withResolvers<undefined>();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    trackLastProjectSave(client, ORG, save.promise);
    const waiting = waitForLastProjectSaves(client, ORG, controller.signal);
    controller.abort();
    await waiting;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    const done = vi.fn();
    const next = waitForLastProjectSaves(
      client,
      ORG,
      new AbortController().signal,
    ).then(done);
    expect(done).not.toHaveBeenCalled();
    save.resolve(undefined);
    await next;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("returns immediately for an already-aborted navigation", async () => {
    const controller = new AbortController();
    controller.abort();
    const add = vi.spyOn(controller.signal, "addEventListener");
    await waitForLastProjectSaves(new QueryClient(), ORG, controller.signal);
    expect(add).not.toHaveBeenCalled();
  });
});
