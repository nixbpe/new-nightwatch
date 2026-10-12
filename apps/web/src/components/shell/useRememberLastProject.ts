import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { projectQueryKeys, rememberLastProject } from "../../lib/api/projects";
import { useCurrentProject } from "./useCurrentProject";

/**
 * Saves the Project of the Project route the user is on as their last one, once per
 * Project change. It waits for the Project to appear in the user's list, so a URL the
 * server would refuse is never sent. Failure is silent: the choice is a convenience.
 */
export function useRememberLastProject(): void {
  const { organizationId, routeProjectId, project } = useCurrentProject();
  const queryClient = useQueryClient();
  const sent = useRef<string | null>(null);
  const projectId =
    project !== null && project.id === routeProjectId ? project.id : null;

  useEffect(() => {
    if (organizationId === null || projectId === null) return;
    const key = `${organizationId}:${projectId}`;
    if (sent.current === key) return;
    sent.current = key;
    void rememberLastProject(organizationId, projectId).then(
      () => {
        // A newer Project change owns the cache; a slower earlier reply must not overwrite it.
        if (sent.current !== key) return;
        queryClient.setQueryData(projectQueryKeys.last(organizationId), {
          projectId,
        });
      },
      () => undefined,
    );
  }, [organizationId, projectId, queryClient]);
}
