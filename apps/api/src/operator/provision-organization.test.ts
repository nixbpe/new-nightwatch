import { describe, expect, it, vi } from "vitest";

import {
  INTERNAL_PROVISIONING_EMAIL,
  parseProvisionArgs,
  type ProvisionArgs,
} from "./provision-organization";

const ARGS: ProvisionArgs = {
  name: "Acme Corp",
  slug: "acme",
  ownerEmail: "owner@example.com",
};

describe("parseProvisionArgs", () => {
  it("parses space-separated flags", () => {
    expect(
      parseProvisionArgs([
        "--name",
        "Acme Corp",
        "--slug",
        "acme",
        "--owner-email",
        "owner@example.com",
      ]),
    ).toEqual(ARGS);
  });

  it("parses --flag=value forms", () => {
    expect(
      parseProvisionArgs([
        "--name=Acme Corp",
        "--slug=acme",
        "--owner-email=owner@example.com",
      ]),
    ).toEqual(ARGS);
  });

  it("rejects an invalid slug with usage and exit 2", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      parseProvisionArgs([
        "--name",
        "Acme",
        "--slug",
        "Acme Corp!",
        "--owner-email",
        "a@b.c",
      ]),
    ).toThrow("process.exit");
    expect(error.mock.calls[0]?.[0]).toContain("Usage:");
    exit.mockRestore();
    error.mockRestore();
  });

  it("refuses the internal principal's own email as owner", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      parseProvisionArgs([
        "--name",
        "Acme",
        "--slug",
        "acme",
        "--owner-email",
        INTERNAL_PROVISIONING_EMAIL.toUpperCase(),
      ]),
    ).toThrow("process.exit");
    exit.mockRestore();
  });
});
