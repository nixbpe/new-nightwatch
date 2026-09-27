import { describe, expect, it } from "vitest";

import {
  assertLocalSeedTarget,
  normalizeDatabaseUrl,
  readSeedConfig,
} from "./seed";

const ownerUrl =
  "postgres://nightwatch_owner:owner-secret@127.0.0.1:5401/nightwatch";
const runtimeUrl =
  "postgres://nightwatch:runtime-secret@127.0.0.1:5401/nightwatch";

describe("local demo seed configuration", () => {
  it("requires the exact computed Compose owner and runtime pair", () => {
    expect(
      readSeedConfig(
        {
          DATABASE_OWNER_URL: ` ${ownerUrl} `,
          DATABASE_URL: ` ${runtimeUrl} `,
        },
        ownerUrl,
        runtimeUrl,
      ),
    ).toEqual({ ownerUrl, runtimeUrl });

    for (const [owner, runtime] of [
      [ownerUrl.replace("5401", "5402"), runtimeUrl],
      [ownerUrl, runtimeUrl.replace("runtime-secret", "other-secret")],
      [ownerUrl, `${runtimeUrl}?application_name=seed`],
      [ownerUrl, runtimeUrl.replace("postgres:", "postgresql:")],
      [ownerUrl, runtimeUrl.replace("127.0.0.1", "localhost")],
      [ownerUrl, runtimeUrl.replace("5401", "5402")],
    ]) {
      expect(() =>
        readSeedConfig(
          { DATABASE_OWNER_URL: owner, DATABASE_URL: runtime },
          ownerUrl,
          runtimeUrl,
        ),
      ).toThrow();
    }
  });

  it("refuses URL fragments and non-local targets without normalizing credentials", () => {
    expect(() => {
      readSeedConfig(
        {
          DATABASE_OWNER_URL: ownerUrl,
          DATABASE_URL: `${runtimeUrl}#ignored`,
        },
        ownerUrl,
        runtimeUrl,
      );
    }).toThrow("must match the computed local Compose");
  });

  it("refuses non-local targets and does not normalize credentials into equivalence", () => {
    expect(() => {
      assertLocalSeedTarget(
        "postgres://nightwatch_owner:secret@db.example.test/nightwatch",
        "nightwatch_owner",
      );
    }).toThrow("loopback");
    expect(() => {
      assertLocalSeedTarget(
        "postgres://nightwatch:secret@127.0.0.1/nightwatch",
        "nightwatch_owner",
      );
    }).toThrow("loopback");
    expect(normalizeDatabaseUrl(ownerUrl)).not.toBe(
      normalizeDatabaseUrl(ownerUrl.replace("owner-secret", "other-secret")),
    );
  });
});
