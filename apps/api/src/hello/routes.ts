import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { helloResponseSchema } from "@nightwatch/api-contract";

import { getHello } from "./service";

export const helloRoute = createRoute({
  method: "get",
  path: "/api/v1/hello",
  tags: ["hello"],
  summary: "Greeting vertical slice",
  responses: {
    200: {
      description: "Greeting with the server timestamp",
      content: { "application/json": { schema: helloResponseSchema } },
    },
  },
});

/** HTTP translation only: wire the route to the pure service. */
export function registerHelloRoutes(app: OpenAPIHono): void {
  app.openapi(helloRoute, (c) => c.json(getHello(), 200));
}
