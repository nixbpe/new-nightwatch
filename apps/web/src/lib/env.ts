import { z } from "zod";

// Empty VITE_API_BASE_URL means same-origin requests, which the Vite dev server proxies to the API.
const envSchema = z.object({
  VITE_API_BASE_URL: z.url().or(z.literal("")).default(""),
});

export const env = envSchema.parse({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
});
