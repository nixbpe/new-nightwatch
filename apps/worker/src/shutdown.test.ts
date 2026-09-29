import { describe, expect, it, vi } from "vitest";

import { armHardDeadline, closeWithin } from "./shutdown";

const never = () => new Promise<void>(() => undefined);

describe("closeWithin", () => {
  it("returns after the timeout and drops the connection when close hangs", async () => {
    const disconnect = vi.fn(never);
    await closeWithin({ close: never, disconnect }, 20);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not disconnect when close completes", async () => {
    const disconnect = vi.fn(never);
    await closeWithin({ close: () => Promise.resolve(), disconnect }, 20);
    expect(disconnect).not.toHaveBeenCalled();
  });
});

describe("armHardDeadline", () => {
  it("logs and exits 1 when the deadline passes", async () => {
    const error = vi.fn();
    const exit = vi.fn();
    armHardDeadline(10, { error } as never, exit);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(error).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
