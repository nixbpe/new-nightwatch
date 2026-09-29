import type { Logger } from "@nightwatch/shared";

const CLOSE_TIMEOUT_MS = 5_000;

type Closable = { close(): Promise<void>; disconnect(): Promise<void> };

/**
 * close() waits on Redis. When Redis is unreachable it may never return, so
 * after the timeout the connection is dropped without waiting for it to end
 * (disconnect() can also wait forever while ioredis is reconnecting).
 */
export async function closeWithin(
  target: Closable,
  ms: number = CLOSE_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
    }, ms);
  });
  const outcome = await Promise.race([
    target.close().then(
      () => "closed" as const,
      () => "closed" as const,
    ),
    timedOut,
  ]);
  clearTimeout(timer);
  if (outcome === "timeout") void target.disconnect().catch(() => undefined);
}

/** Last resort for a shutdown that does not finish: log and exit non-zero. */
export function armHardDeadline(
  ms: number,
  logger: Logger,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  setTimeout(() => {
    logger.error({}, "worker shutdown deadline exceeded");
    exit(1);
  }, ms).unref();
}
