import { z } from "zod";

/**
 * Canonical error envelope for every non-2xx API response.
 * The API must never leak internals: `message` is always safe to display.
 */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
