/**
 * Emit the OpenAPI document without serving HTTP. Composes the real app
 * exactly like src/index.ts — minus the SMTP probe and Bun.serve — so
 * codegen needs no live database, mail server, or running API: the pg
 * pool connects lazily and no query is ever issued.
 *
 * Usage: bun run emit-openapi [output-file]
 * Writes compact JSON to the file argument, or stdout when omitted.
 */
import { createDatabase } from "@nightwatch/db";
import { createLogger, loadAuthEnv, loadEnv } from "@nightwatch/shared";

import { createApp } from "../app";
import { createAuth } from "../auth";
import { createMailer } from "../auth/mailer";

const outputPath = process.argv[2];

const env = loadEnv({ NODE_ENV: "development" });
const authEnv = loadAuthEnv({
  NODE_ENV: "development",
  // Placeholder runtime URL: the pool never connects during spec emission.
  DATABASE_URL: "postgres://nightwatch:nightwatch@127.0.0.1:5432/nightwatch",
});
const logger = createLogger({ level: "silent", name: "emit-openapi" });
const database = createDatabase(authEnv.DATABASE_URL);
const mailer = createMailer(authEnv, logger);
const auth = createAuth({ env, authEnv, logger, database, mailer });
const app = createApp({ env, authEnv, logger, auth, database });

const response = await app.request("/api/v1/openapi.json");
if (!response.ok) {
  throw new Error(
    `OpenAPI document request failed with status ${response.status.toString()}`,
  );
}
const document = await response.text();

if (outputPath) {
  await Bun.write(outputPath, document);
} else {
  process.stdout.write(document);
}
await database.close();
