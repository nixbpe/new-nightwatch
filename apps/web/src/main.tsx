import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { createAppRouter } from "./router";
import "./index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}

// Module scope so auth-driven remounts inside SessionQueryProvider never reset navigation state.
const router = createAppRouter();

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
