// Bun preload for the checker process tests. The Worker resolves names with
// the SSRF helper's own `lookup` import, which cannot be replaced from
// outside, so the source of that one file is patched when it is loaded. The
// host map is a JSON file (`NW_TEST_DNS_FILE`) read on every lookup, so a test
// can change what a name resolves to while the Worker runs. Test use only.
import { readFileSync } from "node:fs";

import { plugin } from "bun";

const IMPORT = 'import { lookup } from "node:dns/promises";';
const STUB = `
import { lookup as realLookup } from "node:dns/promises";
import { readFileSync as readMap } from "node:fs";
const lookup = async (hostname: string, options: never) => {
  const file = process.env.NW_TEST_DNS_FILE;
  const map: Record<string, string> = file ? JSON.parse(readMap(file, "utf8")) : {};
  const address = map[hostname];
  if (address === undefined) return realLookup(hostname, options);
  return [{ address, family: address.includes(":") ? 6 : 4 }];
};`;

plugin({
  name: "nightwatch-test-dns",
  setup(build) {
    build.onLoad({ filter: /outbound-http[\\/]send\.ts$/ }, ({ path }) => {
      const source = readFileSync(path, "utf8");
      if (!source.includes(IMPORT)) {
        throw new Error("send.ts no longer imports lookup as expected");
      }
      return { contents: source.replace(IMPORT, STUB), loader: "ts" };
    });
  },
});
