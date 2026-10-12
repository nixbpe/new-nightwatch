import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { projectQueryKeys, rememberLastProject } from "../../lib/api/projects";
import { useCurrentProject } from "./useCurrentProject";

/**
 * Saves the Project of the Project route the user is on as their last one, once per
 * landing. Re-renders on the same Project send nothing; leaving Project routes and
 * coming back is a new landing and saves again, so a failed save is retried. It waits
 * for the Project to appear in the user's list, so a URL the server would refuse is
 * never sent. Failure is silent: the choice is a convenience.
 * One save is in flight at a time, so the server commits them in the order they were
 * made; while one is in flight only the latest target waits (A, B, C sends A, then C).
 * Unmounting retires the hook (the shell remounts when the signed-in identity changes):
 * a waiting save is dropped and no later continuation sends or writes the cache, so one
 * user's queued navigation never reaches the next user's session. A save already in
 * flight cannot be recalled. A successful save cancels any read of the last Project
 * still in flight, writes the Project to the cache and marks it stale, so a read that
 * began before the save committed cannot leave the previous Project in the switcher.
 */
export function useRememberLastProject(): void {
  const { organizationId, routeProjectId, project } = useCurrentProject();
  const queryClient = useQueryClient();
  // Project of the current landing; cleared when the user leaves Project routes.
  const landed = useRef<string | null>(null);
  // Newest Project a save was requested for; only it may update the cache.
  const sent = useRef<string | null>(null);
  const inFlight = useRef(false);
  const retired = useRef(false);
  const waiting = useRef<{ organizationId: string; projectId: string } | null>(
    null,
  );
  const isRetired = () => retired.current;
  const projectId =
    project !== null && project.id === routeProjectId ? project.id : null;

  useEffect(() => {
    // Reset on mount too, so a Strict Mode mount-unmount-mount probe does not leave it retired.
    retired.current = false;
    const waitingRef = waiting;
    return () => {
      retired.current = true;
      waitingRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (organizationId === null || projectId === null) {
      landed.current = null;
      return;
    }
    const key = `${organizationId}:${projectId}`;
    if (landed.current === key) return;
    landed.current = key;
    sent.current = key;

    function send(target: { organizationId: string; projectId: string }): void {
      inFlight.current = true;
      const targetKey = `${target.organizationId}:${target.projectId}`;
      const lastKey = projectQueryKeys.last(target.organizationId);
      rememberLastProject(target.organizationId, target.projectId)
        .then(
          async () => {
            if (retired.current) return;
            // A newer Project change owns the cache; an earlier reply must not overwrite it.
            if (sent.current !== targetKey) return;
            // A read of the last Project that started before this save committed may still
            // answer with the previous Project. Cancel it so it cannot land after the write.
            await queryClient.cancelQueries({ queryKey: lastKey });
            // Re-read through the ref: either may have changed while cancelling.
            if (isRetired() || sent.current !== targetKey) return;
            queryClient.setQueryData(lastKey, {
              projectId: target.projectId,
            });
            // Reads issued while the save was pending are gone; one issued from here on sees
            // the committed Project. Active readers refetch, inactive ones read it on mount.
            void queryClient.invalidateQueries({ queryKey: lastKey });
          },
          () => undefined,
        )
        .finally(() => {
          inFlight.current = false;
          if (retired.current) return;
          const next = waiting.current;
          waiting.current = null;
          if (next !== null) send(next);
        });
    }

    const target = { organizationId, projectId };
    if (inFlight.current) waiting.current = target;
    else send(target);
  }, [organizationId, projectId, queryClient]);
}
