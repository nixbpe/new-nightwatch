import { z } from "zod";

/** Liveness: the process is up. No dependency checks. */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessCheckSchema = z.enum(["ok", "fail"]);

/** Readiness: self-checks only in this phase (no database/Redis yet). */
export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.record(z.string(), readinessCheckSchema),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
