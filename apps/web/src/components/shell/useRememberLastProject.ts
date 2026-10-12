import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { projectQueryKeys, rememberLastProject } from "../../lib/api/projects";
import { useCurrentProject } from "./useCurrentProject";

/**
 * Saves the Project of the Project route the user is on as their last one, once per
 * Project change. It waits for the Project to appear in the user's list, so a URL the
 * server would refuse is never sent. Failure is silent: the choice is a convenience.
 * One save is in flight at a time, so the server commits them in the order they were
 * made; while one is in flight only the latest target waits (A, B, C sends A, then C).
 */
export function useRememberLastProject(): void {
  const { organizationId, routeProjectId, project } = useCurrentProject();
  const queryClient = useQueryClient();
  const sent = useRef<string | null>(null);
  const inFlight = useRef(false);
  const waiting = useRef<{ organizationId: string; projectId: string } | null>(
    null,
  );
  const projectId =
    project !== null && project.id === routeProjectId ? project.id : null;

  useEffect(() => {
    if (organizationId === null || projectId === null) return;
    const key = `${organizationId}:${projectId}`;
    if (sent.current === key) return;
    sent.current = key;

    function send(target: { organizationId: string; projectId: string }): void {
      inFlight.current = true;
      rememberLastProject(target.organizationId, target.projectId)
        .then(
          () => {
            // A newer Project change owns the cache; an earlier reply must not overwrite it.
            if (sent.current !== `${target.organizationId}:${target.projectId}`)
              return;
            queryClient.setQueryData(
              projectQueryKeys.last(target.organizationId),
              { projectId: target.projectId },
            );
          },
          () => undefined,
        )
        .finally(() => {
          inFlight.current = false;
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
