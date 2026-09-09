import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  errorResponseSchema,
  invitationResponseSchema,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { z } from "zod";

import { getInvitationPreview } from "./service";

export const invitationPreviewRoute = createRoute({
  method: "get",
  path: "/api/onboarding/invitations/{invitationId}",
  tags: ["onboarding"],
  summary: "Public invitation preview for the accept-invitation page",
  request: {
    params: z.object({ invitationId: z.string().min(1) }),
  },
  responses: {
    200: {
      description: "Pending, unexpired invitation preview",
      content: { "application/json": { schema: invitationResponseSchema } },
    },
    404: {
      description: "Unknown, expired or cancelled invitation",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

/** HTTP translation only: wire the route to the transport-free service. */
export function registerOnboardingRoutes(
  app: OpenAPIHono,
  deps: { database: Database },
): void {
  app.openapi(invitationPreviewRoute, (c) => {
    const { invitationId } = c.req.valid("param");
    return getInvitationPreview(deps.database, invitationId).then((body) =>
      c.json(body, 200),
    );
  });
}
