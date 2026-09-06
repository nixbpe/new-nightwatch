import { z } from "zod";

/** Service identity, sourced from the app's package.json. */
export const versionResponseSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

export type VersionResponse = z.infer<typeof versionResponseSchema>;
