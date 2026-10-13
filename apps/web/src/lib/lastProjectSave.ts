import type { QueryClient } from "@tanstack/react-query";

const saves = new WeakMap<QueryClient, Map<string, Set<Promise<void>>>>();

export function trackLastProjectSave(
  client: QueryClient,
  organizationId: string,
  completion: Promise<unknown>,
): void {
  let organizations = saves.get(client);
  if (organizations === undefined) {
    organizations = new Map();
    saves.set(client, organizations);
  }
  let pending = organizations.get(organizationId);
  if (pending === undefined) {
    pending = new Set();
    organizations.set(organizationId, pending);
  }
  const tracked = completion.then(
    () => undefined,
    () => undefined,
  );
  pending.add(tracked);
  void tracked.then(() => {
    pending.delete(tracked);
    if (pending.size === 0) organizations.delete(organizationId);
  });
}

export async function waitForLastProjectSaves(
  client: QueryClient,
  organizationId: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  while (!signal.aborted) {
    const pending = [...(saves.get(client)?.get(organizationId) ?? [])];
    if (pending.length === 0) return;
    await new Promise<void>((resolve) => {
      const stop = () => {
        signal.removeEventListener("abort", stop);
        resolve();
      };
      signal.addEventListener("abort", stop, { once: true });
      void Promise.all(pending).then(() => {
        signal.removeEventListener("abort", stop);
        resolve();
      });
    });
  }
}
