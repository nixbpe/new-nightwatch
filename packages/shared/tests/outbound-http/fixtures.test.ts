import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestPki } from "./fixtures";

vi.mock("node:child_process", { spy: true });
vi.mock("node:fs", { spy: true });

const directories: string[] = [];
const realFs = await vi.importActual<typeof fs>("node:fs");
const realChildProcess =
  await vi.importActual<typeof childProcess>("node:child_process");
const realMkdtemp = realFs.mkdtempSync;

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

function trackDirectory() {
  vi.spyOn(fs, "mkdtempSync").mockImplementation((...args) => {
    const dir = realMkdtemp(...args);
    directories.push(dir);
    return dir;
  });
}

describe("createTestPki cleanup", () => {
  it("disposes successfully acquired certificates", () => {
    trackDirectory();
    const pki = createTestPki();
    try {
      expect(pki.ca).toContain("-----BEGIN CERTIFICATE-----");
      expect(directories.map((dir) => fs.existsSync(dir))).toEqual([true]);
    } finally {
      pki.dispose();
    }
    expect(directories.map((dir) => fs.existsSync(dir))).toEqual([false]);
    pki.dispose();
  });

  it.each(["openssl", "write", "read"] as const)(
    "removes partial key material and rethrows the original %s failure",
    (operation) => {
      trackDirectory();
      const failure = new Error(`injected ${operation} failure`);
      let calls = 0;
      const fail = (): never => {
        expect(directories.map((dir) => fs.readdirSync(dir))).toEqual([
          expect.arrayContaining(["ca.key"]),
        ]);
        throw failure;
      };
      if (operation === "openssl") {
        const real = realChildProcess.execFileSync;
        vi.spyOn(childProcess, "execFileSync").mockImplementation((...args) => {
          if (++calls === 4) return fail();
          return real(...args);
        });
      } else if (operation === "write") {
        const real = realFs.writeFileSync;
        vi.spyOn(fs, "writeFileSync").mockImplementation((...args) => {
          if (++calls === 5) fail();
          real(...args);
        });
      } else {
        const real = realFs.readFileSync;
        vi.spyOn(fs, "readFileSync").mockImplementation((...args) => {
          if (++calls === 10) return fail();
          return real(...args);
        });
      }
      let caught: unknown;
      try {
        createTestPki();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      expect(directories.map((dir) => fs.existsSync(dir))).toEqual([false]);
    },
  );
});
