import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Every test exercising better-auth needs these plugin factories stubbed; the
// real plugins require a live client, which no test provides.
vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

afterEach(() => {
  cleanup();
});
