import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef } from "react";

import { projectQueryKeys, rememberLastProject } from "../../lib/api/projects";
import { trackLastProjectSave } from "../../lib/lastProjectSave";
import { useCurrentProject } from "./useCurrentProject";

type Target = {
  organizationId: string;
  projectId: string;
  selectedAt: string;
  phase: "validating" | "admitted" | "rejected" | "settled";
  finish: () => void;
};

/**
 * Each committed Project landing owns its validation and save completion. Only a
 * readable Project is saved. One save runs at a time; only the latest readable
 * target waits. Failed saves are silent and retried only on a new landing.
 * The timestamp belongs to the URL landing, before validation, and is monotonic
 * within this hook. Other devices still order their landings by their own clocks.
 * Retirement drops unissued work and suppresses late cache writes. An issued
 * request cannot be recalled. Workspace waits for the whole landing lifecycle.
 */
export function useRememberLastProject(): void {
  const { rawProjectRoute, validation } = useCurrentProject();
  const queryClient = useQueryClient();
  const routeOrganizationId = rawProjectRoute?.organizationId ?? null;
  const routeProjectId = rawProjectRoute?.projectId ?? null;
  const routeLanding = useRef<Target | null>(null);
  const sent = useRef<Target | null>(null);
  const inFlight = useRef<Target | null>(null);
  const waiting = useRef<Target | null>(null);
  const retired = useRef(false);
  const lastLandedAt = useRef(0);
  const isRetired = () => retired.current;

  useLayoutEffect(() => {
    retired.current = false;
    const waitingRef = waiting;
    const landingRef = routeLanding;
    const issuedRef = inFlight;
    return () => {
      retired.current = true;
      const queued = waitingRef.current;
      waitingRef.current = null;
      if (queued !== null) {
        queued.phase = "settled";
        queued.finish();
      }
      const landing = landingRef.current;
      if (
        landing !== null &&
        landing !== issuedRef.current &&
        landing !== queued
      ) {
        landing.phase = "rejected";
        landing.finish();
      }
    };
  }, []);

  useLayoutEffect(() => {
    const previous = routeLanding.current;
    if (routeOrganizationId === null || routeProjectId === null) {
      routeLanding.current = null;
    } else {
      const sameRoute =
        previous?.organizationId === routeOrganizationId &&
        previous.projectId === routeProjectId;
      if (
        sameRoute &&
        (previous.phase !== "rejected" || validation === "rejected")
      )
        return;
      const selectedAt = sameRoute
        ? previous.selectedAt
        : new Date(
            (lastLandedAt.current = Math.max(
              Date.now(),
              lastLandedAt.current + 1,
            )),
          ).toISOString();
      const completion = new Promise<void>((finish) => {
        routeLanding.current = {
          organizationId: routeOrganizationId,
          projectId: routeProjectId,
          selectedAt,
          phase: "validating",
          finish,
        };
      });
      trackLastProjectSave(queryClient, routeOrganizationId, completion);
    }
    if (previous !== null && previous.phase === "validating") {
      previous.phase = "settled";
      previous.finish();
    }
  }, [routeOrganizationId, routeProjectId, validation, queryClient]);

  useEffect(() => {
    const target = routeLanding.current;
    if (
      target === null ||
      target.phase !== "validating" ||
      validation === "pending"
    )
      return;
    if (validation === "rejected") {
      target.phase = "rejected";
      target.finish();
      return;
    }
    target.phase = "admitted";
    sent.current = target;

    function send(nextTarget: Target): void {
      inFlight.current = nextTarget;
      const lastKey = projectQueryKeys.last(nextTarget.organizationId);
      void rememberLastProject(
        nextTarget.organizationId,
        nextTarget.projectId,
        nextTarget.selectedAt,
      )
        .then(
          async (stored) => {
            if (retired.current || sent.current !== nextTarget) return;
            await queryClient.cancelQueries({ queryKey: lastKey });
            if (isRetired() || sent.current !== nextTarget) return;
            queryClient.setQueryData(lastKey, { projectId: stored.projectId });
            void queryClient.invalidateQueries({ queryKey: lastKey });
          },
          () => undefined,
        )
        .finally(() => {
          inFlight.current = null;
          if (!retired.current) {
            const next = waiting.current;
            waiting.current = null;
            if (next !== null) send(next);
          }
          nextTarget.phase = "settled";
          nextTarget.finish();
        });
    }

    if (inFlight.current !== null) {
      const superseded = waiting.current;
      waiting.current = target;
      if (superseded !== null) {
        superseded.phase = "settled";
        superseded.finish();
      }
    } else send(target);
  }, [routeOrganizationId, routeProjectId, validation, queryClient]);
}
