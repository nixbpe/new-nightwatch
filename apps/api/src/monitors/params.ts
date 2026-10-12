import {
  monitorNotFoundErrorResponseSchema,
  projectNotFoundErrorResponseSchema,
  projectOrganizationParamsSchema,
} from "@nightwatch/api-contract";
import { z } from "zod";

// Every monitor route lives under its Project. A malformed id answers 404 like
// a missing one (AC-48), so ids are parsed in the handlers, not rejected as 400.
export const monitorBase =
  "/api/organizations/{organizationId}/projects/{projectId}/monitors";

export const monitorProjectParamsSchema =
  projectOrganizationParamsSchema.extend({ projectId: z.string().max(64) });
export const monitorParamsSchema = monitorProjectParamsSchema.extend({
  monitorId: z.string().max(64),
});

export const projectNotFoundResponse = {
  description:
    "The Project does not exist, is malformed or the caller cannot see it",
  content: {
    "application/json": { schema: projectNotFoundErrorResponseSchema },
  },
} as const;

export const monitorNotFoundResponse = {
  description:
    "The Project is hidden from the caller, or the monitor does not exist, is malformed or belongs to another Project",
  content: {
    "application/json": {
      schema: z.union([
        projectNotFoundErrorResponseSchema,
        monitorNotFoundErrorResponseSchema,
      ]),
    },
  },
} as const;
