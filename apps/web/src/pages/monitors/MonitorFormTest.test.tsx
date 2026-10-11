import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import type { MonitorTestResult } from "@nightwatch/api-contract";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext } from "../../lib/api/me";
import { fetchOrganizationNotificationSettings } from "../../lib/api/notifications";
import {
  createMonitor,
  fetchMonitorChecks,
  fetchMonitorDetail,
  fetchMonitorEvents,
  fetchMonitorIncidents,
  fetchMonitorLastResponse,
  fetchMonitorList,
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
  testMonitorDraft,
  testMonitorEdit,
} from "../../lib/api/monitors";
import {
  must,
  noChecks,
  noIncidents,
  noResponseTimes,
} from "./detail-test-support";
import {
  A,
  context,
  deferred,
  detail,
  editPath,
  newPath,
  record,
  renderForm,
} from "./form-test-support";

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../lib/api/notifications", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationNotificationSettings: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createMonitor: vi.fn(),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorEvents: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorLastResponse: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
  fetchMonitorList: vi.fn(),
  testMonitorDraft: vi.fn(),
  testMonitorEdit: vi.fn(),
}));

const draftMock = vi.mocked(testMonitorDraft);
const editTestMock = vi.mocked(testMonitorEdit);
const createMock = vi.mocked(createMonitor);

beforeEach(() => {
  vi.mocked(fetchMeContext).mockResolvedValue(context());
  vi.mocked(fetchMonitorList).mockResolvedValue({
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
    monitors: [],
    page: { limit: 25, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  });
  vi.mocked(fetchMonitorDetail).mockResolvedValue({ monitor: detail() });
  vi.mocked(fetchMonitorChecks).mockResolvedValue(noChecks);
  vi.mocked(fetchMonitorIncidents).mockResolvedValue(noIncidents);
  vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({ events: [] });
  vi.mocked(fetchMonitorResponseTimes).mockResolvedValue(noResponseTimes);
  vi.mocked(fetchMonitorEvents).mockResolvedValue({
    events: [],
    page: { limit: 20, offset: 0, total: 0 },
  });
  vi.mocked(fetchMonitorLastResponse).mockResolvedValue({ response: null });
  createMock.mockResolvedValue({ monitor: record() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

function result(overrides: Partial<MonitorTestResult> = {}): {
  result: MonitorTestResult;
} {
  return {
    result: {
      checkedAt: "2026-09-30T07:30:00.000Z",
      outcome: "pass",
      httpStatus: 200,
      responseTimeMs: 182,
      failureReason: null,
      tlsReason: null,
      assertions: [],
      url: "https://api.acme.example/health",
      evaluatedFromPrefix: false,
      ssl: {
        level: "ok",
        daysRemaining: 128,
        host: "api.acme.example",
        issuer: "Example CA",
        notAfter: "2027-02-05T00:00:00.000Z",
      },
      ...overrides,
    },
  };
}

function expectInvalid(field: HTMLElement) {
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription();
  const described = field.getAttribute("aria-describedby")?.split(" ") ?? [];
  const error = described.find((id) => id.endsWith("-error"));
  expect(error).toBeDefined();
  expect(document.getElementById(must(error))).not.toBeEmptyDOMElement();
}

function assertionRecords() {
  return within(screen.getByTestId("monitor-test-assertions"))
    .getAllByTestId("monitor-test-assertions-row")
    .map((row) => {
      const expected = within(row).getByTestId(
        "monitor-test-assertions-expected",
      );
      const actual = within(row).getByTestId("monitor-test-assertions-actual");
      expect(
        within(row).getByTestId("monitor-test-assertions-status"),
      ).not.toBeEmptyDOMElement();
      expect(actual).not.toBeEmptyDOMElement();
      const clone = actual.cloneNode(true) as HTMLElement;
      const badge = within(clone).queryByTestId(
        "monitor-test-assertions-truncated",
      );
      if (row.getAttribute("data-truncated") === "true") {
        expect(
          within(actual).getByTestId("monitor-test-assertions-truncated"),
        ).toBeVisible();
        expect(badge).not.toBeEmptyDOMElement();
      } else {
        expect(badge).toBeNull();
      }
      badge?.remove();
      return {
        expected: expected.textContent.trim(),
        actual:
          row.getAttribute("data-has-actual") === "false"
            ? null
            : clone.textContent.trim(),
        status: row.getAttribute("data-status"),
        truncated: row.getAttribute("data-truncated") === "true",
      };
    });
}

type User = ReturnType<typeof userEvent.setup>;

async function openCreate(user: User = userEvent.setup()) {
  renderForm(newPath());
  await screen.findByTestId("monitor-form-name");
  await user.type(screen.getByTestId("monitor-form-name"), "Payments API");
  await user.type(
    screen.getByTestId("monitor-form-url"),
    "https://api.acme.example/health",
  );
  return user;
}

const testButton = () => screen.getByTestId("monitor-form-test");

describe("Test panel states", () => {
  it("starts idle with the region already in the DOM", async () => {
    await openCreate();
    expect(screen.getByTestId("monitor-test-idle")).toHaveRole("status");
    expect(screen.getByTestId("monitor-test-idle")).not.toBeEmptyDOMElement();
    expect(draftMock).not.toHaveBeenCalled();
  });

  it("sends one request for a repeated press and keeps the focus on the button", async () => {
    const pending = deferred<ReturnType<typeof result>>();
    draftMock.mockReturnValue(pending.promise);
    const user = await openCreate();
    const region = screen.getByTestId("monitor-test-idle");
    await user.click(testButton());
    expect(testButton()).toHaveAccessibleName();
    expect(screen.getByTestId("monitor-test-running")).toBe(region);
    expect(region).not.toBeEmptyDOMElement();
    expect(testButton()).toHaveAttribute("aria-disabled", "true");
    expect(testButton()).toHaveFocus();
    expect(screen.getByTestId("monitor-test-running")).toBeInTheDocument();
    expect(screen.getByTestId("monitor-form-save")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(testButton());
    await user.keyboard("{Enter}");
    expect(draftMock).toHaveBeenCalledTimes(1);
    pending.resolve(result());
    expect(
      await screen.findByTestId("monitor-test-result"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-outcome",
      "pass",
    );
    expect(testButton()).toHaveFocus();
  });

  it("announces a passing result in the status region with status, time and SSL", async () => {
    draftMock.mockResolvedValue(
      result({
        assertions: [
          {
            kind: "bodyContains",
            expected: "ready",
            actual: null,
            actualType: null,
            actualTruncated: false,
            status: "pass",
            reason: null,
          },
        ],
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    const headline = await screen.findByTestId("monitor-test-result");
    expect(headline).toHaveRole("status");
    expect(headline).not.toBeEmptyDOMElement();
    expect(headline).toHaveAttribute("data-outcome", "pass");
    expect(screen.getByTestId("monitor-test-http-status")).toHaveTextContent(
      "200",
    );
    expect(screen.getByTestId("monitor-test-http-status")).toHaveAttribute(
      "data-http-status",
      "200",
    );
    expect(screen.getByTestId("monitor-test-response-time")).toHaveTextContent(
      "182",
    );
    expect(screen.getByTestId("monitor-test-response-time")).toHaveAttribute(
      "data-response-time-ms",
      "182",
    );
    expect(screen.getByTestId("monitor-test-ssl")).toHaveAttribute(
      "data-level",
      "ok",
    );
    expect(screen.getByTestId("monitor-test-ssl")).toHaveTextContent("128");
    expect(screen.getByTestId("monitor-test-ssl")).toHaveTextContent(
      "Example CA",
    );
    expect(screen.getByTestId("monitor-test-ssl")).toHaveTextContent(
      "api.acme.example",
    );
    expect(assertionRecords()).toEqual(
      expect.arrayContaining([
        {
          expected: "200-299",
          actual: "200",
          status: "pass",
          truncated: false,
        },
        { expected: "ready", actual: null, status: "pass", truncated: false },
      ]),
    );
    expect(assertionRecords()).toHaveLength(2);
    expect(testButton()).toHaveFocus();
  });

  it("shows each failed assertion with the word and the truncation label", async () => {
    draftMock.mockResolvedValue(
      result({
        outcome: "fail",
        failureReason: "assertion_failed",
        assertions: [
          {
            kind: "jsonPathEquals",
            expected: '"ok"',
            actual: '"degraded"',
            actualType: "string",
            actualTruncated: true,
            status: "fail",
            reason: "value_mismatch",
          },
          {
            kind: "bodyContains",
            expected: "ready",
            actual: null,
            actualType: null,
            actualTruncated: false,
            status: "pass",
            reason: null,
          },
        ],
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    expect(
      await screen.findByTestId("monitor-test-result"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-outcome",
      "fail",
    );
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-failure-reason",
      "assertion_failed",
    );
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-failed-assertions",
      "1",
    );
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-assertion-count",
      "2",
    );
    const table = screen.getByTestId("monitor-test-assertions");
    expect(assertionRecords()).toHaveLength(3);
    expect(assertionRecords()).toEqual(
      expect.arrayContaining([
        {
          expected: "200-299",
          actual: "200",
          status: "pass",
          truncated: false,
        },
        {
          expected: '"ok"',
          actual: '"degraded"',
          status: "fail",
          truncated: true,
        },
        { expected: "ready", actual: null, status: "pass", truncated: false },
      ]),
    );
    const failed = within(table)
      .getAllByTestId("monitor-test-assertions-row")
      .filter((row) => row.getAttribute("data-status") === "fail");
    expect(failed).toHaveLength(1);
    expect(
      within(must(failed.pop())).getByTestId(
        "monitor-test-assertions-truncated",
      ),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("monitor-test-assertions")).getByTestId(
        "monitor-test-assertions-truncated",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-test-result")).toBeInTheDocument();
  });

  it.each([
    "blocked_address",
    "redirect_blocked",
    "redirect_limit",
    "dns_not_found",
    "timeout",
    "connect_refused",
  ] as const)(
    "words %s as the target's result, with no address and every assertion not evaluated",
    async (failureReason) => {
      draftMock.mockResolvedValue(
        result({
          outcome: "fail",
          failureReason,
          httpStatus: null,
          responseTimeMs: null,
          assertions: [
            {
              kind: "bodyContains",
              expected: "ready",
              actual: null,
              actualType: null,
              actualTruncated: false,
              status: "not_evaluated",
              reason: "no_response",
            },
          ],
        }),
      );
      const user = await openCreate();
      await user.click(testButton());
      expect(
        await screen.findByTestId("monitor-test-result"),
      ).not.toBeEmptyDOMElement();
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "fail",
      );
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-failure-reason",
        failureReason,
      );

      expect(assertionRecords()).toHaveLength(2);
      expect(assertionRecords()).toEqual(
        expect.arrayContaining([
          {
            expected: "200-299",
            actual: null,
            status: "not_evaluated",
            truncated: false,
          },
          {
            expected: "ready",
            actual: null,
            status: "not_evaluated",
            truncated: false,
          },
        ]),
      );
      expect(document.body.textContent).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    },
  );

  it("uses the timeout of the tested configuration in the timeout wording", async () => {
    draftMock.mockResolvedValue(
      result({ outcome: "fail", failureReason: "timeout", httpStatus: null }),
    );
    const user = await openCreate();
    await user.click(screen.getByTestId("monitor-form-mode-advanced"));
    fireEvent.change(screen.getByTestId("monitor-form-timeout"), {
      target: { value: "5" },
    });
    await user.click(testButton());
    expect(
      await screen.findByTestId("monitor-test-result"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-outcome",
      "fail",
    );
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-failure-reason",
      "timeout",
    );
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-timeout-seconds",
      "5",
    );
    expect(screen.getByTestId("monitor-test-result")).toHaveTextContent(
      /\b5\b/,
    );
  });

  it.each([
    "hostname_mismatch",
    "expired",
    "self_signed",
    "handshake_failed",
    null,
  ] as const)("words a TLS failure (%s)", async (tlsReason) => {
    draftMock.mockResolvedValue(
      result({
        outcome: "fail",
        failureReason: "tls_invalid",
        tlsReason,
        httpStatus: null,
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    expect(
      await screen.findByTestId("monitor-test-result"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-outcome",
      "fail",
    );
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-failure-reason",
      "tls_invalid",
    );
    if (tlsReason === null)
      expect(screen.getByTestId("monitor-test-result")).not.toHaveAttribute(
        "data-tls-reason",
      );
    else
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-tls-reason",
        tlsReason,
      );
  });

  it("words a system-side check error apart from a target failure", async () => {
    draftMock.mockResolvedValue(
      result({
        outcome: "check_error",
        failureReason: "executor_error",
        httpStatus: null,
        responseTimeMs: null,
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    expect(
      await screen.findByTestId("monitor-test-result"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-outcome",
      "check_error",
    );
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-failure-reason",
      "executor_error",
    );
    expect(screen.getByTestId("monitor-test-result")).not.toHaveAttribute(
      "data-outcome",
      "fail",
    );
  });

  it("labels the result stale once the form changes", async () => {
    draftMock.mockResolvedValue(result());
    const user = await openCreate();
    await user.click(testButton());
    await screen.findByTestId("monitor-test-result");
    expect(screen.queryByTestId("monitor-test-stale")).toBeNull();
    await user.type(screen.getByTestId("monitor-form-name"), " 2");
    expect(screen.getByTestId("monitor-test-stale")).not.toBeEmptyDOMElement();
  });

  it("tests an invalid form by showing the errors beside the fields and sending nothing", async () => {
    const user = userEvent.setup();
    renderForm(newPath());
    await screen.findByTestId("monitor-form-name");
    await user.click(testButton());
    expect(draftMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("monitor-form-name")).toHaveFocus();
    expectInvalid(screen.getByTestId("monitor-form-url"));
  });
});

describe("Test panel SSL line", () => {
  it.each([
    ["ok", 128],
    ["caution", 21],
    ["danger", 5],
    ["expired", -2],
    ["unreadable", null],
    ["not_https", null],
  ] as const)("words level %s", async (level, daysRemaining) => {
    draftMock.mockResolvedValue(
      result({
        ssl: {
          level,
          daysRemaining,
          host: "api.acme.example",
          issuer: "Example CA",
          notAfter: "2027-02-05T00:00:00.000Z",
        },
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    const ssl = await screen.findByTestId("monitor-test-ssl");
    expect(ssl).toHaveAttribute("data-level", level);
    expect(ssl).toHaveTextContent("Example CA");
    expect(ssl).toHaveTextContent("api.acme.example");
    if (daysRemaining === null)
      expect(ssl).not.toHaveAttribute("data-days-remaining");
    else {
      expect(ssl).toHaveAttribute("data-days-remaining", String(daysRemaining));
      expect(ssl).toHaveTextContent(String(Math.abs(daysRemaining)));
    }
  });

  it("renders no SSL line for no_data", async () => {
    draftMock.mockResolvedValue(
      result({
        ssl: {
          level: "no_data",
          daysRemaining: null,
          host: null,
          issuer: null,
          notAfter: null,
        },
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    await screen.findByTestId("monitor-test-result");
    expect(screen.queryByTestId("monitor-test-ssl")).toBeNull();
  });
});

describe("Test service errors", () => {
  it.each([
    ["RATE_LIMIT_UNAVAILABLE", 503],
    ["INTERNAL_ERROR", 500],
    ["CREDENTIALS_UNAVAILABLE", 503],
  ] as const)(
    "shows %s as an alert apart from a target result",
    async (code, httpStatus) => {
      draftMock.mockRejectedValue(
        new ApiError(code, "internal detail 10.0.0.1", httpStatus),
      );
      const user = await openCreate();
      await user.click(testButton());
      expect(
        await screen.findByTestId("monitor-test-service-error"),
      ).toHaveRole("alert");
      expect(
        screen.getByTestId("monitor-test-service-error"),
      ).not.toBeEmptyDOMElement();
      expect(screen.queryByTestId("monitor-test-result")).toBeNull();
      expect(document.body.textContent).not.toMatch(/10\.0\.0\.1/);
      expect(screen.getByTestId("monitor-form-name")).toHaveValue(
        "Payments API",
      );
      expect(testButton()).toHaveFocus();
    },
  );

  it("disables the button for retryAfterSeconds without announcing a countdown", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    draftMock.mockRejectedValueOnce(
      new ApiError("MONITOR_TEST_RATE_LIMITED", "slow down", 429, {
        retryAfterSeconds: 3,
      }),
    );
    const user = userEvent.setup({ delay: null });
    await openCreate(user);
    await user.click(testButton());
    expect(
      await screen.findByTestId("monitor-test-rateLimited"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-test-rateLimited")).toHaveRole("status");
    expect(
      screen.getByTestId("monitor-test-rateLimited"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-test-rateLimited")).not.toContainElement(
      screen.getByTestId("monitor-test-wait"),
    );
    expect(testButton()).toHaveAttribute("aria-disabled", "true");
    expect(testButton()).toHaveFocus();
    expect(screen.getByTestId("monitor-test-wait")).toHaveAttribute(
      "data-remaining-seconds",
      "3",
    );
    expect(screen.getByTestId("monitor-test-wait")).toHaveTextContent("3");
    await user.click(testButton());
    expect(draftMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByTestId("monitor-test-wait")).toHaveAttribute(
      "data-remaining-seconds",
      "2",
    );
    expect(screen.getByTestId("monitor-test-wait")).toHaveTextContent("2");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByTestId("monitor-test-wait")).toBeNull();
    expect(testButton()).toHaveAttribute("aria-disabled", "false");
    draftMock.mockResolvedValueOnce(result());
    await user.click(testButton());
    expect(
      await screen.findByTestId("monitor-test-result"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-outcome",
      "pass",
    );
    expect(draftMock).toHaveBeenCalledTimes(2);
  });

  it("maps a MONITOR_INVALID answer to the fields", async () => {
    draftMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, {
        fields: [{ field: "url", reason: "blocked_port" }],
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    await waitFor(() => {
      expectInvalid(screen.getByTestId("monitor-form-url"));
    });
    expect(screen.getByTestId("monitor-form-url")).toHaveFocus();
  });

  it("keeps the values and shows the role change on PERMISSION_DENIED", async () => {
    draftMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "d", 403));
    const user = await openCreate();
    vi.mocked(fetchMeContext).mockResolvedValue(context("viewer"));
    await user.click(testButton());
    expect(
      await screen.findByTestId("monitor-form-role-changed"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-form-name")).toHaveValue("Payments API");
    await waitFor(() => {
      expect(testButton()).toHaveAttribute("aria-disabled", "true");
    });
    expect(testButton()).toHaveFocus();
  });
});

describe("Saving and testing are independent", () => {
  it("saves without a test", async () => {
    const user = await openCreate();
    await user.click(screen.getByTestId("monitor-form-save"));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(draftMock).not.toHaveBeenCalled();
  });

  it("saves after a failed test", async () => {
    draftMock.mockResolvedValue(
      result({
        outcome: "fail",
        failureReason: "http_status",
        httpStatus: 503,
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    await waitFor(() => {
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "fail",
      );
    });
    expect(screen.getByTestId("monitor-test-http-status")).toHaveTextContent(
      "503",
    );
    await user.click(screen.getByTestId("monitor-form-save"));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  });

  it("sends the draft test without a request id or version", async () => {
    draftMock.mockResolvedValue(result());
    const user = await openCreate();
    await user.click(testButton());
    await screen.findByTestId("monitor-test-result");
    const body = draftMock.mock.calls[0]?.[1];
    expect(body).toMatchObject({
      name: "Payments API",
      secrets: [],
    });
    expect(body).not.toHaveProperty("clientRequestId");
    expect(body).not.toHaveProperty("expectedVersion");
  });
});

describe("Edit test", () => {
  it("shows the origin wording beside the URL on a 422 from the server", async () => {
    vi.mocked(fetchMonitorDetail).mockResolvedValue({ monitor: detail() });
    editTestMock.mockRejectedValue(
      new ApiError("MONITOR_SECRET_ORIGIN_CHANGED", "x", 422),
    );
    const user = userEvent.setup();
    renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.click(testButton());
    await waitFor(() => {
      expectInvalid(screen.getByTestId("monitor-form-url"));
    });
  });

  it("shows not-found when the monitor is gone at test time", async () => {
    vi.mocked(fetchMonitorDetail).mockResolvedValue({ monitor: detail() });
    editTestMock.mockRejectedValue(
      new ApiError("MONITOR_NOT_FOUND", "nf", 404),
    );
    const user = userEvent.setup();
    renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.click(testButton());
    expect(
      await screen.findByTestId("monitor-form-not-found"),
    ).toBeInTheDocument();
  });
});

describe("Redesign mockups and notes", () => {
  it("shows no result status while idle and the actual HTTP status after a failed test", async () => {
    draftMock.mockResolvedValue(
      result({
        outcome: "fail",
        failureReason: "http_status",
        httpStatus: 503,
      }),
    );
    const user = await openCreate();
    expect(screen.getByTestId("monitor-test-idle")).toHaveRole("status");
    expect(screen.queryByTestId("monitor-test-http-status")).toBeNull();
    await user.click(testButton());
    await waitFor(() => {
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "fail",
      );
    });
    expect(screen.getByTestId("monitor-test-http-status")).toHaveAttribute(
      "data-http-status",
      "503",
    );
    expect(screen.getByTestId("monitor-test-http-status")).toHaveTextContent(
      "503",
    );
    expect(assertionRecords()).toEqual([
      { expected: "200-299", actual: "503", status: "fail", truncated: false },
    ]);
  });

  it("describes the URL input with the scheme and redirect note", async () => {
    await openCreate();
    expect(
      screen.getByTestId("monitor-form-url"),
    ).toHaveAccessibleDescription();
  });

  it.each([
    [true, true],
    [false, false],
  ])(
    "shows the recipient note when organization monitor alerts are on and the suppression note when off (enabled=%s)",
    async (enabled, shown) => {
      vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
        organizationId: A,
        version: 1,
        settingsChangedEnabled: true,
        monitorAlertsEnabled: enabled,
      });
      await openCreate();

      await waitFor(() => {
        expect(fetchOrganizationNotificationSettings).toHaveBeenCalled();
      });
      if (shown) {
        expect(
          await screen.findByTestId("monitor-form-org-alerts-enabled"),
        ).not.toBeEmptyDOMElement();
        expect(
          screen.queryByTestId("monitor-form-org-alerts-disabled"),
        ).toBeNull();
      } else {
        expect(
          await screen.findByTestId("monitor-form-org-alerts-disabled"),
        ).not.toBeEmptyDOMElement();
        expect(
          screen.queryByTestId("monitor-form-org-alerts-enabled"),
        ).toBeNull();
      }
    },
  );

  it("hides the alert note when the org setting cannot be read", async () => {
    vi.mocked(fetchOrganizationNotificationSettings).mockRejectedValue(
      new ApiError("FORBIDDEN", "no", 403),
    );
    await openCreate();

    await waitFor(() => {
      expect(fetchOrganizationNotificationSettings).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("monitor-form-org-alerts-enabled")).toBeNull();
  });

  it("keeps keyboard focus between Cancel and Save", async () => {
    const user = await openCreate();
    screen.getByTestId("monitor-form-cancel").focus();
    await user.tab();
    expect(screen.getByTestId("monitor-form-save")).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByTestId("monitor-form-cancel")).toHaveFocus();
  });

  it("shows the calls per day for the chosen interval", async () => {
    const user = await openCreate();
    expect(screen.getByTestId("monitor-form-calls-per-day")).toHaveTextContent(
      /^288$/,
    );
    await user.click(screen.getByTestId("monitor-form-interval-60"));
    expect(screen.getByTestId("monitor-form-calls-per-day")).toHaveTextContent(
      /^1,440$/,
    );
  });
});

describe("Alerts section controls", () => {
  beforeEach(() => {
    vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
      organizationId: A,
      version: 1,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
    });
  });

  const thresholdSelect = () =>
    screen.getByTestId("monitor-form-alert-threshold");
  const downCheckbox = () => screen.getByTestId("monitor-form-alert-down");
  const sslCheckbox = () => screen.getByTestId("monitor-form-alert-ssl");
  const daysField = () => screen.getByTestId("monitor-form-alert-days");

  it("defaults to 2 failures, both toggles on and 30 days, and sends that object unchanged", async () => {
    const user = await openCreate();
    expect(thresholdSelect()).toHaveValue("2");
    expect(downCheckbox()).toBeChecked();
    expect(sslCheckbox()).toBeChecked();
    expect(daysField()).toHaveValue("30");
    await user.click(screen.getByTestId("monitor-form-save"));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[1]).toMatchObject({
      alerts: {
        failureThreshold: 2,
        downEnabled: true,
        sslEnabled: true,
        sslCautionDays: 30,
      },
    });
  });

  it("gives the failure threshold an accessible description that it determines down status even when down alerts are off", async () => {
    await openCreate();
    expect(thresholdSelect()).toHaveAccessibleDescription();
  });

  it("updates the down-status note to 3 failures and submits the complete alerts object with the selected values", async () => {
    const user = await openCreate();
    await user.selectOptions(thresholdSelect(), "3");
    expect(screen.getByTestId("monitor-form-down-summary")).toHaveAttribute(
      "data-failure-threshold",
      "3",
    );
    expect(screen.getByTestId("monitor-form-down-summary")).toHaveTextContent(
      "3",
    );
    await user.click(downCheckbox());
    fireEvent.change(daysField(), { target: { value: "10" } });
    await user.click(screen.getByTestId("monitor-form-save"));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[1]).toMatchObject({
      alerts: {
        failureThreshold: 3,
        downEnabled: false,
        sslEnabled: true,
        sslCautionDays: 10,
      },
    });
  });

  it("makes SSL caution days read-only with an accessible explanation when SSL alerts are off and preserves the value when re-enabled", async () => {
    const user = await openCreate();
    fireEvent.change(daysField(), { target: { value: "12" } });
    await user.click(sslCheckbox());
    expect(daysField()).toHaveAttribute("aria-readonly", "true");
    expect(daysField()).toHaveAccessibleDescription();
    expect(daysField()).toHaveValue("12");
    await user.click(sslCheckbox());
    expect(daysField()).not.toHaveAttribute("aria-readonly");
    expect(daysField()).toHaveValue("12");
  });

  it("blocks saving with 40 SSL caution days, marks and focuses the field, and describes the allowed 8-to-30 range", async () => {
    const user = await openCreate();
    fireEvent.change(daysField(), { target: { value: "40" } });
    await user.click(screen.getByTestId("monitor-form-save"));
    expect(createMock).not.toHaveBeenCalled();
    expect(daysField()).toHaveAttribute("aria-invalid", "true");
    expectInvalid(daysField());
    expect(daysField()).toHaveFocus();
  });
});
