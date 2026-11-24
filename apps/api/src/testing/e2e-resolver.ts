import { lookup } from "node:dns/promises";
import type { OutboundDeps } from "@nightwatch/shared";

// Only the E2E entry installs this DNS boundary fixture. The real outbound
// executor still classifies ENOTFOUND under the request's normal deadline.
export const e2eResolver: NonNullable<OutboundDeps["resolver"]> = async (
  hostname,
) => {
  if (hostname === "dns-not-found.nw-e2e.invalid") {
    throw Object.assign(new Error("E2E DNS fixture"), { code: "ENOTFOUND" });
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};
