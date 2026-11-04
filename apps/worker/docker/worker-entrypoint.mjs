import { existsSync } from "node:fs";
import process from "node:process";
import console from "node:console";

if (!process.env.NODE_ENV) {
  console.error(
    "nightwatch-worker: NODE_ENV is unset; refusing to start. Set NODE_ENV=production.",
  );
  process.exit(78);
}

if (
  process.env.NODE_ENV !== "production" &&
  (process.env.NODE_ENV !== "development" ||
    !existsSync("/etc/nightwatch-worker-dev-build"))
) {
  console.error(
    "nightwatch-worker: NODE_ENV must be production; refusing to start.",
  );
  process.exit(78);
}

await import("./dist/index.js");
