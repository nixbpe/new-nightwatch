import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  errorResponseSchema,
  invitationAcceptResponseSchema,
  invitationResponseSchema,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { z } from "zod";

import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { acceptInvitation, getInvitationPreview } from "./service";

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

export const invitationAcceptRoute = createRoute({
  method: "post",
  path: "/api/onboarding/invitations/{invitationId}/accept",
  tags: ["onboarding"],
  summary: "Accept an invitation for the verified recipient",
  request: { params: z.object({ invitationId: z.string().min(1) }) },
  responses: {
    200: {
      description: "Accepted membership",
      content: {
        "application/json": { schema: invitationAcceptResponseSchema },
      },
    },
    404: {
      description: "Invitation unavailable to this recipient",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    409: {
      description: "Already a member or organization at capacity",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

export function registerOnboardingRoutes(
  app: OpenAPIHono,
  deps: { database: Database; auth: Auth },
): void {
  app.openapi(invitationPreviewRoute, (c) => {
    const { invitationId } = c.req.valid("param");
    return getInvitationPreview(deps.database, invitationId).then((body) =>
      c.json(body, 200),
    );
  });
  app.openapi(invitationAcceptRoute, async (c) => {
    const { invitationId } = c.req.valid("param");
    const session = await requireVerifiedSession(deps.auth, c.req.raw.headers);
    const organizationId = await acceptInvitation(deps.database, {
      invitationId,
      userId: session.user.id,
      email: session.user.email,
    });
    return c.json({ organizationId }, 200);
  });
}
