import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { createAppRouter } from "./router";
import "./index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}

// Module scope: the router outlives every render, so auth-driven remounts
// inside SessionQueryProvider can never reset navigation state.
const router = createAppRouter();

createRoot(container).render(
  <StrictMode>
    {/* Renders nothing while the initial document load's loaders run (the
        session gate + me/context prefetch on a hard load of /workspace). */}
    <RouterProvider router={router} />
  </StrictMode>,
);
