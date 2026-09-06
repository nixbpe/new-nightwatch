import { z } from "zod";

/** Response contract for GET /api/v1/hello (vertical slice). */
export const helloResponseSchema = z.object({
  message: z.string().min(1),
  /** Server time when the greeting was produced, ISO 8601 UTC. */
  timestamp: z.string().datetime(),
});

export type HelloResponse = z.infer<typeof helloResponseSchema>;
