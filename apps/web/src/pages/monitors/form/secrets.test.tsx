import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { record } from "../form-test-support";
import {
  defaultValues,
  editBaseFromRecord,
  secretOriginChanged,
  testSnapshot,
  valuesFromRecord,
} from "./model";
import { planEntries, secretShape, useSecretStore } from "./secrets";

const SECRET = `snap-${crypto.randomUUID()}`;

describe("what the Test panel keeps of the secrets", () => {
  const stored = record({
    auth: { type: "basic" },
    secretSlots: [
      { slot: "auth.username", configured: true },
      { slot: "auth.password", configured: true },
    ],
  });

  it("holds only slots and actions, no value, no per-slot number, no digest", () => {
    const values = {
      ...valuesFromRecord(stored),
      replacing: ["auth.password"],
    };
    const entries = planEntries(values, editBaseFromRecord(stored), (slot) =>
      slot === "auth.password" ? SECRET : "",
    );
    const snapshot = testSnapshot(values, entries);
    expect(JSON.stringify(snapshot)).not.toContain(SECRET);
    expect(JSON.parse(snapshot.secretShape)).toEqual([
      ["auth.username", "keep"],
      ["auth.password", "replace"],
    ]);
    expect(secretShape(entries)).toBe(snapshot.secretShape);
    // The only additions to the plain config are the shape string.
    expect(Object.keys(snapshot)).toContain("secretShape");
    expect(Object.keys(snapshot)).not.toContain("secrets");
  });

  it("keeps the same shape while the typed text changes, so only the flag can mark a result stale", () => {
    const values = {
      ...valuesFromRecord(stored),
      replacing: ["auth.password"],
    };
    const base = editBaseFromRecord(stored);
    const a = testSnapshot(
      values,
      planEntries(values, base, () => "one"),
    );
    const b = testSnapshot(
      values,
      planEntries(values, base, () => "two"),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("exposes a boolean changed flag and one global render counter, nothing per slot", () => {
    const hook = renderHook(() => useSecretStore());
    const plain = (store: ReturnType<typeof useSecretStore>) =>
      Object.fromEntries(
        Object.entries(store).filter(
          ([, value]) => typeof value !== "function",
        ),
      );
    expect(plain(hook.result.current)).toEqual({ version: 0, changed: false });
    act(() => {
      hook.result.current.set("auth.token", SECRET);
    });
    expect(plain(hook.result.current)).toEqual({ version: 1, changed: true });
    expect(JSON.stringify(plain(hook.result.current))).not.toContain(SECRET);
    act(() => {
      hook.result.current.markClean();
    });
    expect(hook.result.current.changed).toBe(false);
    act(() => {
      hook.result.current.drop(["auth.token"]);
    });
    expect(hook.result.current.changed).toBe(true);
  });
});

describe("origin comparison follows the server's WHATWG origin", () => {
  const stored = record({
    url: "https://api.acme.example/health",
    auth: { type: "bearer" },
    secretSlots: [{ slot: "auth.token", configured: true }],
  });
  const base = editBaseFromRecord(stored);
  const changed = (url: string) =>
    secretOriginChanged(base, { ...valuesFromRecord(stored), url });

  it.each([
    ["the explicit default port", "https://api.acme.example:443/health", false],
    ["an upper-case host", "https://API.Acme.Example/health", false],
    ["a path, query and fragment", "https://api.acme.example/x?y=1#z", false],
    ["surrounding spaces", "  https://api.acme.example/health  ", false],
    ["a trailing dot on the host", "https://api.acme.example./health", true],
    ["another port", "https://api.acme.example:8443/health", true],
    ["http instead of https", "http://api.acme.example/health", true],
    ["another host", "https://other.example/health", true],
    ["a subdomain", "https://www.api.acme.example/health", true],
  ])("treats %s as %s", (_name, url, expected) => {
    expect(changed(url)).toBe(expected);
  });

  it("compares an IDN host by its punycode form", () => {
    const idn = editBaseFromRecord(
      record({
        url: "https://bücher.example/health",
        auth: { type: "bearer" },
        secretSlots: [{ slot: "auth.token", configured: true }],
      }),
    );
    const values = { ...defaultValues(), auth: { type: "bearer" as const } };
    expect(
      secretOriginChanged(idn, {
        ...values,
        url: "https://xn--bcher-kva.example/health",
      }),
    ).toBe(false);
    expect(
      secretOriginChanged(idn, { ...values, url: "https://bucher.example/" }),
    ).toBe(true);
  });

  it("does not count a URL that does not parse as a change", () => {
    expect(changed("not a url")).toBe(false);
  });

  it("canonicalizes stored slots once, so an upper-case header id still counts as stored", () => {
    const id = "0F6A4B7E-1C2D-4E3F-8A9B-0C1D2E3F4A5B";
    const withHeader = record({
      headers: [{ id, name: "X-Key", secret: true }],
      secretSlots: [{ slot: `header.${id}`, configured: true }],
    });
    const values = valuesFromRecord(withHeader);
    const entries = planEntries(
      values,
      editBaseFromRecord(withHeader),
      () => "",
    );
    expect(entries.map((e) => [e.slot, e.action])).toEqual([
      [`header.${id.toLowerCase()}`, "keep"],
    ]);
  });
});
