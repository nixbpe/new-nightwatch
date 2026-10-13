import type { QueryClient } from "@tanstack/react-query";

type LandingSaves = { pending: Set<Promise<void>>; revision: symbol };
const saves = new WeakMap<QueryClient, Map<string, LandingSaves>>();

export function getLastProjectLandingRevision(
  client: QueryClient,
  organizationId: string,
): symbol | undefined {
  return saves.get(client)?.get(organizationId)?.revision;
}

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
  const pending =
    organizations.get(organizationId)?.pending ?? new Set<Promise<void>>();
  organizations.set(organizationId, { pending, revision: Symbol() });
  const tracked = completion.then(
    () => undefined,
    () => undefined,
  );
  pending.add(tracked);
  void tracked.then(() => {
    pending.delete(tracked);
  });
}

export async function waitForLastProjectSaves(
  client: QueryClient,
  organizationId: string,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    const pending = [
      ...(saves.get(client)?.get(organizationId)?.pending ?? []),
    ];
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
