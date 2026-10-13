import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  trackLastProjectSave,
  waitForLastProjectSaves,
} from "./lastProjectSave";

const ORG = "11111111-1111-4111-8111-111111111111";

describe("last Project save barrier", () => {
  it("waits for every concurrent save of the same client and Organization", async () => {
    const client = new QueryClient();
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    trackLastProjectSave(client, ORG, first.promise);
    trackLastProjectSave(client, ORG, second.promise);
    const done = vi.fn();
    const waiting = waitForLastProjectSaves(
      client,
      ORG,
      new AbortController().signal,
    ).then(done);
    first.resolve();
    await first.promise;
    expect(done).not.toHaveBeenCalled();
    second.resolve();
    await waiting;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("includes the next save registered by the previous save's finally", async () => {
    const client = new QueryClient();
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
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
    first.resolve();
    await vi.waitFor(() => expect(nextStarted).toHaveBeenCalledTimes(1));
    expect(done).not.toHaveBeenCalled();
    second.resolve();
    await waiting;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("releases a failed save without propagating its error", async () => {
    const client = new QueryClient();
    const save = Promise.withResolvers<void>();
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
    const save = Promise.withResolvers<void>();
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
    save.resolve();
  });

  it("aborts the wait without retiring the pending save and removes its listener", async () => {
    const client = new QueryClient();
    const save = Promise.withResolvers<void>();
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
    save.resolve();
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
