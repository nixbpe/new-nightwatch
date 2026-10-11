import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import {
  auditScopeNote,
  type AuditExportListResponse,
  type AuditExportRecord,
} from "@nightwatch/api-contract";
import { QueryClient } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  claimContextPublication,
  createContextPublicationClaim,
  publishContextPublication,
} from "../../lib/queryClient";
import {
  createAuditExport,
  downloadAuditExport,
  fetchAuditActors,
  fetchAuditEvents,
  fetchAuditExports,
} from "../../lib/api/audit-log";
import { ApiError } from "../../lib/api/client";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { PREFERENCES_KEY } from "../../lib/preferences";
import { AuditLogPage } from "./AuditLogPage";
import {
  makeEvent,
  makeList,
  makeRecord,
  ORG_A,
  renderRoute,
  setTenant,
  setTimeZone,
  type TestRole,
} from "./test-support";

vi.mock("../../lib/tenant/TenantProvider", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import("./test-support")).tenantMock(),
}));
vi.mock("../../lib/api/audit-log", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchAuditEvents: vi.fn(),
  fetchAuditActors: vi.fn(),
  fetchAuditExports: vi.fn(),
  createAuditExport: vi.fn(),
  downloadAuditExport: vi.fn(),
}));

const listMock = vi.mocked(fetchAuditEvents);
const exportsMock = vi.mocked(fetchAuditExports);
const createMock = vi.mocked(createAuditExport);
const downloadMock = vi.mocked(downloadAuditExport);

const PATH = "/organizations/:organizationId/audit-log";
const LIST_ASOF = "2026-10-03T07:02:11.000Z";
const denied = (code: "PERMISSION_DENIED" | "MEMBERSHIP_DENIED") =>
  new ApiError(code, "x", 403);
const exportList = (
  exports: AuditExportRecord[],
  inProgress = exports.some((row) => row.status === "generating"),
): AuditExportListResponse => ({ exports, inProgress });

function open(
  options: {
    role?: TestRole;
    rows?: AuditExportRecord[];
    inProgress?: boolean;
    total?: number;
    search?: string;
    hash?: string;
    queryClient?: QueryClient;
    exportsError?: ApiError;
  } = {},
) {
  setTenant(options.role ?? "owner");
  listMock.mockResolvedValue(
    makeList([makeEvent(0)], options.total ?? 1234, { asOf: LIST_ASOF }),
  );
  if (options.exportsError === undefined) {
    exportsMock.mockResolvedValue(
      exportList(options.rows ?? [], options.inProgress),
    );
  } else {
    exportsMock.mockRejectedValue(options.exportsError);
  }
  return renderRoute(<AuditLogPage />, {
    path: PATH,
    entry: `/organizations/${ORG_A}/audit-log${options.search ?? ""}${options.hash ?? ""}`,
    queryClient: options.queryClient,
  });
}
const exportButton = () => screen.findByTestId("audit-export-open");
const sectionHeading = async () => {
  await screen.findByTestId("audit-export-jobs-table");
  return screen.getByTestId("audit-export-jobs-title");
};
const DEFAULT_JOB_ID = makeRecord().id;
const row = (id: string) =>
  within(screen.getByTestId("audit-export-jobs")).getByTestId(
    `audit-export-job-${id}`,
  );
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const opener = await exportButton();
  await waitFor(() => expect(opener).not.toHaveAttribute("aria-disabled"));
  await user.click(opener);
  return screen.findByTestId("audit-export-dialog");
}

beforeEach(() => {
  setTimeZone("Asia/Bangkok");
  vi.mocked(fetchAuditActors).mockResolvedValue({ actors: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  localStorage.removeItem(PREFERENCES_KEY);
});

describe("export button", () => {
  it.each(["auditor", "viewer"] as const)(
    "does not render the button or the section and never asks for the exports of a %s",
    async (role) => {
      open({ role });
      if (role === "auditor") await screen.findByTestId("audit-events-table");
      else await screen.findByTestId("audit-denied-title");
      expect(screen.queryByTestId("audit-export-open")).toBeNull();
      expect(screen.queryByTestId("audit-export-jobs-title")).toBeNull();
      expect(exportsMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
      expect(downloadMock).not.toHaveBeenCalled();
    },
  );

  it("is aria-disabled with the visible reason when the filter matches nothing", async () => {
    open({ total: 0 });
    const button = await exportButton();
    await screen.findByTestId("audit-export-reason");
    await waitFor(() =>
      expect(screen.getByTestId("audit-export-reason")).toHaveAttribute(
        "data-blocked-reason",
        "empty",
      ),
    );
    expect(
      screen.getByTestId("audit-export-reason").textContent.trim(),
    ).not.toBe("");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-describedby", "audit-export-reason");
    await userEvent.setup().click(button);
    expect(screen.queryByTestId("audit-export-dialog")).toBeNull();
  });

  it("explains why ส่งออก is unavailable while the list loads", async () => {
    setTenant("owner");
    listMock.mockReturnValue(new Promise(() => undefined));
    exportsMock.mockResolvedValue(exportList([]));
    renderRoute(<AuditLogPage />, {
      path: PATH,
      entry: `/organizations/${ORG_A}/audit-log`,
    });
    const button = await exportButton();
    expect(button).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByTestId("audit-export-reason");
    expect(reason).toHaveAttribute("data-blocked-reason", "loading");
    expect(reason.textContent.trim()).not.toBe("");
    expect(button).toHaveAttribute("aria-describedby", reason.id);
  });

  it("explains why ส่งออก is unavailable for an invalid custom range", async () => {
    open({ search: "?range=custom&from=2026-10-02&to=2026-10-01" });
    const button = await exportButton();
    const reason = screen.getByTestId("audit-export-reason");
    expect(reason).toHaveAttribute("data-blocked-reason", "invalid-range");
    expect(reason.textContent.trim()).not.toBe("");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-describedby", reason.id);
  });

  it("shows กำลังสร้างไฟล์… and shares one reason with every ขอใหม่ while a request runs", async () => {
    open({
      inProgress: true,
      rows: [
        makeRecord({ id: "11111111-1111-4111-8111-111111111111" }),
        makeRecord({
          id: "22222222-2222-4222-8222-222222222222",
          status: "failed",
          failureCode: "EXPORT_FAILED",
        }),
        makeRecord({
          id: "33333333-3333-4333-8333-333333333333",
          status: "expired",
        }),
      ],
    });
    const button = await screen.findByTestId("audit-export-open");
    await waitFor(() =>
      expect(button).toHaveAttribute("data-in-progress", "true"),
    );
    expect(button).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByTestId("audit-export-reason");
    expect(reason).toHaveAttribute("data-blocked-reason", "in-progress");
    expect(reason).toHaveTextContent(/\b60\b/);
    expect(reason).toHaveTextContent(/\b1\b/);
    expect(reason.textContent.trim()).not.toBe("");
    expect(screen.getAllByTestId("audit-export-reason")).toHaveLength(1);
    const retries = await screen.findAllByTestId("audit-export-job-retry");
    expect(retries).toHaveLength(2);
    for (const control of [button, ...retries]) {
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("aria-describedby", reason.id);
    }
  });
});

describe("export dialog", () => {
  it("starts on CSV and shows the snapshot, scope and actual total", async () => {
    const user = userEvent.setup();
    open({ search: "?categories=member" });
    const dialog = await openDialog(user);
    expect(
      within(dialog).getByTestId("audit-export-dialog-format-csv"),
    ).toHaveFocus();
    expect(
      within(dialog).getByTestId("audit-export-dialog-format-csv"),
    ).toBeChecked();
    expect(
      within(dialog).getByTestId("audit-export-dialog-formats"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("audit-export-dialog-snapshot"),
    ).toHaveTextContent("14:02:11");
    expect(
      within(dialog).getByTestId("audit-export-dialog-snapshot"),
    ).toHaveAttribute("data-time-zone", "Asia/Bangkok");
    expect(
      within(dialog).getByTestId("audit-export-dialog-total"),
    ).toHaveTextContent(/^1,234$/);
    expect(
      within(dialog).getByTestId("audit-export-dialog-filters"),
    ).toHaveAttribute("data-categories", "member");
    expect(
      within(dialog)
        .getByTestId("audit-export-dialog-filters")
        .textContent.trim(),
    ).not.toBe("");
    const recording = within(dialog).getByTestId("audit-recording-scope");
    expect(recording).toHaveAttribute("data-recording-since", "2025-06-01");
    // Public contract note agrees with the page/dialog/file disclosure contract, not cosmetic UI copy.
    expect(recording).toHaveTextContent(auditScopeNote("2025-06-01"));
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).not.toHaveAccessibleName("");
  });

  it("makes the scrolling body a named, focusable region and keeps first focus on CSV", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    const body = within(dialog).getByTestId("audit-export-dialog-body");
    expect(body).toHaveAttribute("tabindex", "0");
    expect(body).toHaveAttribute("role", "region");
    expect(body).not.toHaveAccessibleName("");
    expect(
      within(dialog).getByTestId("audit-export-dialog-format-csv"),
    ).toHaveFocus();
    await user.tab({ shift: true });
    expect(body).toHaveFocus();
  });

  it("traps Tab inside and returns focus to the button on cancel", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    const cancel = within(dialog).getByTestId("audit-export-dialog-cancel");
    const create = within(dialog).getByTestId("audit-export-dialog-create");
    const body = within(dialog).getByTestId("audit-export-dialog-body");
    create.focus();
    await user.tab();
    // The scrolling body is the first stop of the trap, so Tab from the last control wraps to it.
    expect(body).toHaveFocus();
    await user.tab({ shift: true });
    expect(create).toHaveFocus();
    await user.click(cancel);
    expect(screen.queryByTestId("audit-export-dialog")).toBeNull();
    expect(await exportButton()).toHaveFocus();
  });

  it("sends the list's asOf and absolute from/to, the zone and the filters", async () => {
    const user = userEvent.setup();
    open({ search: "?categories=member&q=ada&actor=user-1" });
    const dialog = await openDialog(user);
    createMock.mockResolvedValue({ export: makeRecord() });
    await user.click(
      within(dialog).getByTestId("audit-export-dialog-format-json"),
    );
    await user.click(within(dialog).getByTestId("audit-export-dialog-create"));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const [organizationId, body] = createMock.mock.calls[0] ?? [];
    const listParams = listMock.mock.calls[0]?.[1];
    expect(organizationId).toBe(ORG_A);
    expect(body).toEqual({
      format: "json",
      timeZone: "Asia/Bangkok",
      filters: {
        from: listParams?.from,
        to: LIST_ASOF,
        categories: ["member"],
        actorUserId: "user-1",
        q: "ada",
      },
      asOf: LIST_ASOF,
    });
  });

  it("keeps a custom range's own from and to", async () => {
    const user = userEvent.setup();
    open({ search: "?range=custom&from=2026-09-26&to=2026-10-02" });
    const dialog = await openDialog(user);
    createMock.mockResolvedValue({ export: makeRecord() });
    await user.click(within(dialog).getByTestId("audit-export-dialog-create"));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalled();
    });
    expect(createMock.mock.calls[0]?.[1].filters).toMatchObject({
      from: "2026-09-25T17:00:00.000Z",
      to: "2026-10-02T16:59:59.999Z",
    });
  });

  it("ignores a second press, Cancel and Escape while the request is out", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    const pending = Promise.withResolvers<{ export: AuditExportRecord }>();
    createMock.mockReturnValue(pending.promise);
    const create = within(dialog).getByTestId("audit-export-dialog-create");
    await user.click(create);
    await user.click(create);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(create).toHaveAttribute("aria-busy", "true");
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).not.toBeDisabled();
    expect(dialog).toHaveAttribute("aria-busy", "true");
    const cancel = within(dialog).getByTestId("audit-export-dialog-cancel");
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    await user.click(cancel);
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("audit-export-dialog")).toBeInTheDocument();
    pending.resolve({ export: makeRecord() });
    await waitFor(() => {
      expect(screen.queryByTestId("audit-export-dialog")).toBeNull();
    });
  });

  it("shows the too-large state with the server's total and an aria-disabled button", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    createMock.mockRejectedValue(
      new ApiError("AUDIT_EXPORT_TOO_LARGE", "x", 422, {
        limit: 50000,
        total: 61234,
      }),
    );
    await user.click(within(dialog).getByTestId("audit-export-dialog-create"));
    const alert = await within(dialog).findByTestId(
      "audit-export-dialog-too-large",
    );
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("61,234");
    expect(alert).toHaveTextContent("50,000");
    expect(
      within(dialog).getByTestId("audit-export-dialog-total"),
    ).toHaveTextContent(/^61,234$/);
    const create = within(dialog).getByTestId("audit-export-dialog-create");
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).toHaveAttribute("aria-describedby", alert.id);
    await user.click(create);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("opens already too large when the list has more than 50,000 rows", async () => {
    const user = userEvent.setup();
    open({ total: 50_001 });
    const dialog = await openDialog(user);
    expect(
      within(dialog).getByTestId("audit-export-dialog-total"),
    ).toHaveTextContent(/^50,001$/);
    expect(
      within(dialog).getByTestId("audit-export-dialog-too-large"),
    ).toHaveTextContent("50,001");
    expect(
      within(dialog).getByTestId("audit-export-dialog-too-large"),
    ).toHaveTextContent("50,000");
    const create = within(dialog).getByTestId("audit-export-dialog-create");
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).toHaveAttribute(
      "aria-describedby",
      within(dialog).getByTestId("audit-export-dialog-too-large").id,
    );
    await user.click(create);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("explains an empty result and keeps the choices", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    createMock.mockRejectedValue(new ApiError("AUDIT_EXPORT_EMPTY", "x", 422));
    await user.click(
      within(dialog).getByTestId("audit-export-dialog-format-json"),
    );
    await user.click(within(dialog).getByTestId("audit-export-dialog-create"));
    const alert = await within(dialog).findByTestId(
      "audit-export-dialog-error",
    );
    expect(alert).toHaveAttribute("data-outcome", "empty");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent.trim()).not.toBe("");
    expect(
      within(dialog).getByTestId("audit-export-dialog-create"),
    ).not.toHaveAttribute("aria-disabled");
    expect(
      within(dialog).getByTestId("audit-export-dialog-format-json"),
    ).toBeChecked();
  });

  it("closes on 409 and loads the exports again", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    createMock.mockRejectedValue(
      new ApiError("AUDIT_EXPORT_IN_PROGRESS", "x", 409),
    );
    const before = exportsMock.mock.calls.length;
    exportsMock.mockResolvedValue(exportList([makeRecord()], true));
    await user.click(within(dialog).getByTestId("audit-export-dialog-create"));
    await waitFor(() => {
      expect(screen.queryByTestId("audit-export-dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(exportsMock.mock.calls.length).toBeGreaterThan(before);
    });
    await waitFor(() =>
      expect(screen.getByTestId("audit-export-open")).toHaveAttribute(
        "data-in-progress",
        "true",
      ),
    );
  });

  it("keeps the dialog open with the retry message on a network error", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    createMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    await user.click(within(dialog).getByTestId("audit-export-dialog-create"));
    const alert = await within(dialog).findByTestId(
      "audit-export-dialog-error",
    );
    expect(alert).toHaveAttribute("data-outcome", "failed");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent.trim()).not.toBe("");
    expect(
      within(dialog).getByTestId("audit-export-dialog-create"),
    ).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("audit-export-dialog")).toBeInTheDocument();
  });

  it("aborts a request that takes more than 15 s and gives Cancel and Escape back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    open();
    const dialog = await openDialog(user);
    createMock.mockImplementation(
      (_org, _body, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new ApiError("NETWORK_ERROR", "x", 0));
          });
        }),
    );
    await user.click(within(dialog).getByTestId("audit-export-dialog-create"));
    expect(
      within(dialog).getByTestId("audit-export-dialog-create"),
    ).toHaveAttribute("aria-busy", "true");
    await act(() => vi.advanceTimersByTimeAsync(15_001));
    const alert = await within(dialog).findByTestId(
      "audit-export-dialog-error",
    );
    expect(alert).toHaveAttribute("data-outcome", "failed");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent.trim()).not.toBe("");
    expect(
      within(dialog).getByTestId("audit-export-dialog-create"),
    ).not.toHaveAttribute("aria-disabled");
    expect(
      within(dialog).getByTestId("audit-export-dialog-cancel"),
    ).not.toHaveAttribute("aria-disabled");
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("audit-export-dialog")).toBeNull();
  });
});

describe("after the request is accepted", () => {
  it("shows กำลังสร้างไฟล์… before the refetch lands, then the notice with working links", async () => {
    const user = userEvent.setup();
    const view = open();
    const dialog = await openDialog(user);
    // C6-02: the page's live region is there before the request, empty.
    const region = screen.getByTestId("audit-export-announcement");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toBeEmptyDOMElement();
    const refetch = Promise.withResolvers<AuditExportListResponse>();
    exportsMock.mockReturnValue(refetch.promise);
    createMock.mockResolvedValue({ export: makeRecord() });
    await user.click(within(dialog).getByTestId("audit-export-dialog-create"));
    await waitFor(() => {
      expect(screen.queryByTestId("audit-export-dialog")).toBeNull();
    });
    const button = screen.getByTestId("audit-export-open");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
    expect(
      view.queryClient.getQueryData(["tenant", "audit-log", "exports", ORG_A]),
    ).toMatchObject({ inProgress: true });
    expect(screen.getByTestId("audit-export-jobs-title")).toBeInTheDocument();
    expect(region.textContent.trim()).not.toBe("");
    const requested = screen.getByTestId("audit-export-requested-notice");
    const notice = within(requested).getByTestId("action-notice-message");
    // The visible notice is not a second live region, so nothing is announced twice.
    expect(notice).not.toHaveAttribute("role");
    expect(
      within(notice).getByTestId("audit-export-notifications-link"),
    ).toHaveAttribute("href", "/notifications");
    const showFiles = screen.getByTestId("audit-export-show-jobs");
    expect(notice).not.toContainElement(showFiles);
    await user.click(showFiles);
    expect(screen.getByTestId("audit-export-jobs-title")).toHaveFocus();
    const close = within(requested).getByTestId("action-notice-close");
    expect(notice).not.toContainElement(close);
    await user.click(close);
    expect(screen.queryByTestId("audit-export-requested-notice")).toBeNull();
    expect(region).toBeEmptyDOMElement();
    expect(button).toHaveFocus();
    refetch.resolve(
      exportList(
        [
          makeRecord({
            status: "ready",
            expiresAt: "2026-10-04T07:07:30.000Z",
          }),
        ],
        false,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("audit-export-open")).toHaveAttribute(
        "data-in-progress",
        "false",
      ),
    );
    expect(screen.getByTestId("audit-export-open")).not.toHaveAttribute(
      "aria-disabled",
    );
  });
});

describe("my exports section", () => {
  it("is a captioned table with one live region and rows with their own button names", async () => {
    const view = open({
      rows: [
        makeRecord({
          id: "11111111-1111-4111-8111-111111111111",
          status: "ready",
          expiresAt: "2026-10-04T07:07:30.000Z",
          filters: {
            ...makeRecord().filters,
            q: "secret-term",
            actorUserId: "user-1",
          },
        }),
        makeRecord({
          id: "22222222-2222-4222-8222-222222222222",
          format: "json",
          status: "expired",
        }),
      ],
    });
    await sectionHeading();
    const table = screen.getByTestId("audit-export-jobs-table");
    expect(table.tagName).toBe("TABLE");
    expect(table).not.toHaveAccessibleName("");
    expect(
      within(table)
        .getAllByTestId("audit-export-job-format")
        .map((cell) => cell.textContent.trim()),
    ).toEqual(["CSV", "JSON"]);
    const first = row("11111111-1111-4111-8111-111111111111");
    expect(first).toHaveTextContent(
      "2026-09-26 00:00:00 – 2026-10-03 14:02:00 (Asia/Bangkok)",
    );
    expect(within(first).getByTestId("audit-export-job-scope")).toHaveAttribute(
      "data-categories",
      "member",
    );
    expect(within(first).getByTestId("audit-export-job-scope")).toHaveAttribute(
      "data-search-applied",
      "true",
    );
    expect(first).not.toHaveTextContent("secret-term");
    expect(document.body.innerHTML).not.toContain("secret-term");
    expect(
      view.queryClient
        .getQueryData<AuditExportListResponse>([
          "tenant",
          "audit-log",
          "exports",
          ORG_A,
        ])
        ?.exports.map(({ id, filters }) => ({ id, q: filters.q })),
    ).toEqual([
      { id: "11111111-1111-4111-8111-111111111111", q: "secret-term" },
      { id: "22222222-2222-4222-8222-222222222222", q: null },
    ]);
    expect(first).toHaveTextContent("2026-10-03 14:05:10 Asia/Bangkok");
    expect(first).toHaveAttribute("data-status", "ready");
    expect(
      within(first).getByTestId("audit-export-job-expires-at"),
    ).toHaveTextContent("2026-10-04 14:07:30 Asia/Bangkok");
    expect(
      within(first).getByTestId("audit-export-job-download"),
    ).toHaveAccessibleName(/CSV.*2026-10-03 14:05/);
    expect(row("22222222-2222-4222-8222-222222222222")).toHaveAttribute(
      "data-status",
      "expired",
    );
    expect(
      within(row("22222222-2222-4222-8222-222222222222")).getByTestId(
        "audit-export-job-retry",
      ),
    ).not.toHaveAttribute("aria-disabled");
    const section = screen.getByTestId("audit-export-jobs");
    expect(
      within(section).getByTestId("audit-export-jobs-status"),
    ).toHaveAttribute("role", "status");
    // Native live-region family scan guards duplicate announcements, never locates a component.
    expect(section.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("wraps the table in a focusable, named scroll region", async () => {
    open({
      rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
    });
    await sectionHeading();
    const region = screen.getByTestId("audit-export-jobs-region");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toContainElement(
      screen.getByTestId("audit-export-jobs-table"),
    );
    expect(region).toHaveAttribute("role", "region");
    expect(region).not.toHaveAccessibleName("");
    region.focus();
    expect(region).toHaveFocus();
  });

  it("shows the scope in the zone the request was made in and the request times in the viewer's zone", async () => {
    // Bangkok is the viewer's preference (set in beforeEach); the request was made in New York.
    open({
      rows: [
        makeRecord({
          status: "ready",
          timeZone: "America/New_York",
          expiresAt: "2026-10-04T07:07:30.000Z",
          filters: {
            ...makeRecord().filters,
            from: "2026-09-25T17:00:00.000Z",
            to: "2026-10-03T07:02:00.000Z",
          },
        }),
      ],
    });
    await sectionHeading();
    const first = row(DEFAULT_JOB_ID);
    expect(first).toHaveTextContent(
      "2026-09-25 13:00:00 – 2026-10-03 03:02:00 (America/New_York)",
    );
    expect(first).not.toHaveTextContent("(Asia/Bangkok)");
    expect(first).toHaveTextContent("2026-10-03 14:05:10 Asia/Bangkok");
    expect(
      within(first).getByTestId("audit-export-job-expires-at"),
    ).toHaveTextContent("2026-10-04 14:07:30 Asia/Bangkok");
  });

  it("hides the section when there are no requests", async () => {
    open({ rows: [] });
    await screen.findByTestId("audit-events-table");
    await waitFor(() => {
      expect(exportsMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("audit-export-jobs-title")).toBeNull();
  });

  it.each([
    [
      "EXPORT_TOO_LARGE",
      "ไฟล์ใหญ่เกิน 25 MiB ขอใหม่ด้วยขอบเขตเดิมจะล้มเหลวอีก ลดช่วงเวลาหรือเพิ่มตัวกรองก่อน",
    ],
    [
      "EXPORT_FAILED",
      "สร้างไฟล์ไม่สำเร็จเพราะระบบขัดข้อง ขอใหม่ได้ด้วยขอบเขตเดิม",
    ],
    [
      "REQUESTER_NOT_AUTHORIZED",
      "สร้างไฟล์ไม่สำเร็จเพราะสิทธิ์ส่งออกของคุณเปลี่ยนระหว่างสร้าง",
    ],
  ] as const)("explains a failed row: %s", async (failureCode, text) => {
    open({ rows: [makeRecord({ status: "failed", failureCode })] });
    await sectionHeading();
    expect(row(DEFAULT_JOB_ID)).toHaveAttribute("data-status", "failed");
    expect(row(DEFAULT_JOB_ID)).toHaveAttribute(
      "data-failure-code",
      failureCode,
    );
    expect(
      within(row(DEFAULT_JOB_ID))
        .getByTestId("audit-export-job-status")
        .textContent.trim(),
    ).not.toBe("");
    if (text.includes("25 MiB"))
      expect(row(DEFAULT_JOB_ID)).toHaveTextContent("25 MiB");
    expect(
      within(row(DEFAULT_JOB_ID)).getByTestId("audit-export-job-retry"),
    ).toBeInTheDocument();
  });

  it("writes the row's scope into the filters and focuses the filter section from ปรับตัวกรอง", async () => {
    const user = userEvent.setup();
    open({
      rows: [
        makeRecord({
          status: "failed",
          failureCode: "EXPORT_TOO_LARGE",
          filters: {
            ...makeRecord().filters,
            categories: ["member", "monitor"],
            actorUserId: "user-1",
            q: "ada",
          },
        }),
      ],
    });
    await sectionHeading();
    const adjust = within(row(DEFAULT_JOB_ID)).getByTestId(
      "audit-export-job-adjust",
    );
    const retry = within(row(DEFAULT_JOB_ID)).getByTestId(
      "audit-export-job-retry",
    );
    expect(retry).toBeInTheDocument();
    await user.click(adjust);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `?range=custom&from=2026-09-26&to=2026-10-03&categories=member%2Cmonitor&actor=user-1&q=ada`,
      );
    });
    expect(screen.getByTestId("audit-filters-title")).toHaveFocus();
    // The day range covers the row's instants: 2026-09-26 00:00 Bangkok is before 25 17:00Z.
    await waitFor(() => {
      expect(listMock.mock.calls.at(-1)?.[1]).toMatchObject({
        from: "2026-09-25T17:00:00.000Z",
        to: "2026-10-03T16:59:59.999Z",
      });
    });
  });

  it.each([["failed"], ["expired"]] as const)(
    "ขอใหม่ on a %s row posts the row's absolute scope with asOf now and keeps focus on the button",
    async (status) => {
      const user = userEvent.setup();
      const now = new Date("2026-10-03T08:00:00.000Z");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      const record = makeRecord({
        status,
        failureCode: status === "failed" ? "EXPORT_FAILED" : null,
        format: "json",
        filters: { ...makeRecord().filters, actorUserId: "user-1", q: "ada" },
      });
      open({ rows: [record] });
      await sectionHeading();
      const created = makeRecord({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        requestedAt: now.toISOString(),
      });
      createMock.mockResolvedValue({ export: created });
      exportsMock.mockResolvedValue(exportList([created, record], true));
      const retry = within(row(record.id)).getByTestId(
        "audit-export-job-retry",
      );
      await user.click(retry);
      await waitFor(() => {
        expect(createMock).toHaveBeenCalledTimes(1);
      });
      expect(createMock.mock.calls[0]?.[1]).toEqual({
        format: "json",
        timeZone: "Asia/Bangkok",
        filters: {
          from: record.filters.from,
          to: record.filters.to,
          categories: ["member"],
          actorUserId: "user-1",
          q: "ada",
        },
        asOf: now.toISOString(),
      });
      // N-1: no dialog and no second notice; focus stays on the (now aria-disabled) button.
      expect(screen.queryByTestId("audit-export-dialog")).toBeNull();
      expect(screen.queryByTestId("audit-export-requested-notice")).toBeNull();
      await waitFor(() => {
        expect(retry).toHaveAttribute("aria-disabled", "true");
      });
      expect(retry).toHaveFocus();
      expect(screen.getByTestId("audit-export-open")).toHaveAttribute(
        "data-in-progress",
        "true",
      );
    },
  );

  it.each([
    [
      new ApiError("AUDIT_EXPORT_TOO_LARGE", "x", 422, {
        limit: 50000,
        total: 70000,
      }),
      "ข้อมูลมากเกินไปสำหรับการส่งออกครั้งเดียว ลดช่วงเวลาแล้วลองใหม่ (พบ 70,000 รายการ สูงสุด 50,000)",
    ],
    [
      new ApiError("AUDIT_EXPORT_EMPTY", "x", 422),
      "ไม่มีรายการให้ส่งออกตามตัวกรองนี้",
    ],
    [
      new ApiError("AUDIT_EXPORT_IN_PROGRESS", "x", 409),
      "สร้างไฟล์ส่งออกได้ครั้งละ 1 คำขอ รอให้ไฟล์ปัจจุบันเสร็จก่อน",
    ],
    [
      new ApiError("NETWORK_ERROR", "x", 0),
      "ส่งคำขอส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง",
    ],
  ])(
    "shows a ขอใหม่ error in the row with role=alert (%#)",
    async (error, text) => {
      const user = userEvent.setup();
      open({
        rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
      });
      await sectionHeading();
      createMock.mockRejectedValue(error);
      const retry = within(row(DEFAULT_JOB_ID)).getByTestId(
        "audit-export-job-retry",
      );
      await user.click(retry);
      const alert = await within(row(DEFAULT_JOB_ID)).findByTestId(
        "audit-export-job-error",
      );
      expect(alert).toHaveAttribute("role", "alert");
      expect(alert.textContent.trim()).not.toBe("");
      for (const value of text.match(/\d[\d,]*/g) ?? [])
        expect(alert).toHaveTextContent(value);
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(retry).toHaveAttribute("aria-describedby", alert.id);
    },
  );

  it("polls every 5 s, announces a status change once and refreshes the notifications", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const generating = makeRecord();
    const view = open({ rows: [generating] });
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");
    await sectionHeading();
    const callsBefore = exportsMock.mock.calls.length;
    exportsMock.mockResolvedValue(
      exportList([
        {
          ...generating,
          status: "ready",
          expiresAt: "2026-10-04T07:07:30.000Z",
        },
      ]),
    );
    await act(() => vi.advanceTimersByTimeAsync(5_100));
    const section = screen.getByTestId("audit-export-jobs");
    await waitFor(() => {
      expect(
        within(section).getByTestId("audit-export-jobs-status"),
      ).toHaveTextContent("CSV");
      expect(
        within(section).getByTestId("audit-export-jobs-status"),
      ).toHaveTextContent("2026-10-03 14:05:10 Asia/Bangkok");
      expect(row(DEFAULT_JOB_ID)).toHaveAttribute("data-status", "ready");
    });
    expect(exportsMock.mock.calls.length).toBe(callsBefore + 1);
    expect(row(DEFAULT_JOB_ID)).toHaveAttribute("data-status", "ready");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["tenant", "notifications"],
    });
    // Nothing is generating any more, so the polling stops.
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(exportsMock.mock.calls.length).toBe(callsBefore + 1);
  });

  it("keeps the rows and offers ลองใหม่ when a poll fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    open({ rows: [makeRecord()] });
    await sectionHeading();
    exportsMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    await act(() => vi.advanceTimersByTimeAsync(8_000));
    expect(
      await screen.findByTestId("audit-export-jobs-stale"),
    ).toBeInTheDocument();
    expect(row(DEFAULT_JOB_ID)).toHaveAttribute("data-status", "generating");
    exportsMock.mockResolvedValue(
      exportList([
        makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" }),
      ]),
    );
    await user.click(screen.getByTestId("audit-export-jobs-retry"));
    await waitFor(() => {
      expect(row(DEFAULT_JOB_ID)).toHaveAttribute("data-status", "failed");
    });
    expect(screen.queryByTestId("audit-export-jobs-stale")).toBeNull();
  });
});

describe("download", () => {
  const ready = makeRecord({
    status: "ready",
    expiresAt: "2026-10-04T07:07:30.000Z",
  });
  let click: MockInstance<() => void>;
  const createObjectUrl = vi.fn<(blob: Blob) => string>();
  const revokeObjectUrl = vi.fn<(url: string) => void>();
  beforeEach(() => {
    createObjectUrl.mockReturnValue("blob:test");
    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = revokeObjectUrl;
    click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
  });

  it("saves the file under the name from the header and shows กำลังดาวน์โหลด… meanwhile", async () => {
    const user = userEvent.setup();
    open({ rows: [ready] });
    await sectionHeading();
    const pending = Promise.withResolvers<{
      blob: Blob;
      filename: string | null;
    }>();
    downloadMock.mockReturnValue(pending.promise);
    const button = within(row(DEFAULT_JOB_ID)).getByTestId(
      "audit-export-job-download",
    );
    let download = "";
    let href = "";
    let target = "";
    click.mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download;
      href = this.href;
      target = this.target;
    });
    await user.click(button);
    expect(button).toHaveAttribute("data-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(downloadMock).toHaveBeenCalledTimes(1);
    const blob = new Blob(["a"], { type: "text/csv" });
    pending.resolve({
      blob,
      filename: "nightwatch-audit-log.csv",
    });
    await waitFor(() => {
      expect(button).toHaveAttribute("data-busy", "false");
      expect(button).not.toHaveAttribute("aria-disabled");
    });
    expect(download).toBe("nightwatch-audit-log.csv");
    expect(href).toBe("blob:test");
    expect(target).toBe("");
    expect(createObjectUrl).toHaveBeenCalledWith(blob);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:test");
    expect(click).toHaveBeenCalledTimes(1);
    expect(downloadMock).toHaveBeenCalledWith(
      ORG_A,
      ready.id,
      expect.any(AbortSignal),
    );
  });

  it.each([
    [
      new ApiError("AUDIT_EXPORT_NOT_FOUND", "x", 404),
      "ไม่พบไฟล์นี้ โหลดรายการล่าสุดแล้ว",
      true,
    ],
    [
      new ApiError("AUDIT_EXPORT_NOT_READY", "x", 409),
      "ไฟล์ยังไม่พร้อม โหลดรายการล่าสุดแล้ว",
      true,
    ],
    [
      new ApiError("NETWORK_ERROR", "x", 0),
      "ดาวน์โหลดไม่สำเร็จ ลองใหม่อีกครั้ง",
      false,
    ],
  ])("reports %# in the row", async (error, text, refetches) => {
    const user = userEvent.setup();
    open({ rows: [ready] });
    await sectionHeading();
    downloadMock.mockRejectedValue(error);
    const before = exportsMock.mock.calls.length;
    await user.click(
      within(row(DEFAULT_JOB_ID)).getByTestId("audit-export-job-download"),
    );
    const alert = await within(row(DEFAULT_JOB_ID)).findByTestId(
      "audit-export-job-error",
    );
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent.trim()).not.toBe("");
    expect(
      within(row(DEFAULT_JOB_ID)).getByTestId("audit-export-job-download"),
    ).not.toHaveAttribute("aria-disabled");
    if (refetches) {
      await waitFor(() => {
        expect(exportsMock.mock.calls.length).toBeGreaterThan(before);
      });
    } else {
      expect(exportsMock.mock.calls.length).toBe(before);
    }
  });

  it("turns the row into expired with ขอใหม่ on 410", async () => {
    const user = userEvent.setup();
    open({ rows: [ready] });
    await sectionHeading();
    downloadMock.mockRejectedValue(
      new ApiError("AUDIT_EXPORT_EXPIRED", "x", 410),
    );
    await user.click(
      within(row(DEFAULT_JOB_ID)).getByTestId("audit-export-job-download"),
    );
    await waitFor(() => {
      expect(row(DEFAULT_JOB_ID)).toHaveAttribute("data-status", "expired");
    });
    expect(
      within(row(DEFAULT_JOB_ID)).getByTestId("audit-export-job-retry"),
    ).toBeInTheDocument();
    expect(
      within(row(DEFAULT_JOB_ID)).queryByTestId("audit-export-job-download"),
    ).toBeNull();
  });
});

describe("403 during export", () => {
  const notice = () => screen.findByTestId("audit-export-permission-notice");

  async function expectRevoked(queryClient: QueryClient, exportsCalls: number) {
    const box = await notice();
    const text = within(box).getByTestId("action-notice-message");
    expect(box).toHaveFocus();
    expect(text).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("audit-export-open")).toBeNull();
    expect(screen.queryByTestId("audit-export-jobs-title")).toBeNull();
    expect(screen.queryByTestId("audit-export-dialog")).toBeNull();
    // The list stays readable and the exports stop being asked.
    expect(screen.getByTestId("audit-events-region")).toBeInTheDocument();
    expect(
      queryClient.getQueryData(["tenant", "audit-log", "exports", ORG_A]),
    ).toBeUndefined();
    expect(queryClient.getQueryState(ME_CONTEXT_QUERY_KEY)?.isInvalidated).toBe(
      true,
    );
    await act(() => Promise.resolve());
    expect(exportsMock.mock.calls.length).toBe(exportsCalls);
  }
  const seeded = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, {
      user: {
        id: "user-1",
        name: "Tester",
        email: "test@example.test",
        emailVerified: true,
        twoFactorEnabled: false,
      },
      organizations: [],
      lastActiveTenantId: ORG_A,
    });
    return queryClient;
  };

  it("handles a 403 from the exports list", async () => {
    const queryClient = seeded();
    open({ queryClient, exportsError: denied("PERMISSION_DENIED") });
    await notice();
    await expectRevoked(queryClient, exportsMock.mock.calls.length);
  });

  it("handles a 403 from the POST and closes the dialog", async () => {
    const user = userEvent.setup();
    const queryClient = seeded();
    open({
      queryClient,
      rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
    });
    const dialog = await openDialog(user);
    createMock.mockRejectedValue(denied("PERMISSION_DENIED"));
    await user.click(within(dialog).getByTestId("audit-export-dialog-create"));
    await expectRevoked(queryClient, exportsMock.mock.calls.length);
  });

  it("handles a 403 from ขอใหม่", async () => {
    const user = userEvent.setup();
    const queryClient = seeded();
    open({
      queryClient,
      rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
    });
    await sectionHeading();
    createMock.mockRejectedValue(denied("PERMISSION_DENIED"));
    await user.click(
      within(row(DEFAULT_JOB_ID)).getByTestId("audit-export-job-retry"),
    );
    await expectRevoked(queryClient, exportsMock.mock.calls.length);
  });

  it("handles a 403 from a download", async () => {
    const user = userEvent.setup();
    const queryClient = seeded();
    open({
      queryClient,
      rows: [
        makeRecord({ status: "ready", expiresAt: "2026-10-04T07:07:30.000Z" }),
      ],
    });
    await sectionHeading();
    downloadMock.mockRejectedValue(denied("PERMISSION_DENIED"));
    await user.click(
      within(row(DEFAULT_JOB_ID)).getByTestId("audit-export-job-download"),
    );
    await expectRevoked(queryClient, exportsMock.mock.calls.length);
  });

  it("sends MEMBERSHIP_DENIED to the page's denied card", async () => {
    open({ exportsError: denied("MEMBERSHIP_DENIED") });
    const heading = await screen.findByTestId("audit-denied-title");
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(screen.getByTestId("audit-denied-message")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-events-region")).toBeNull();
  });
});

describe("requests in flight when the scope retires or the page unmounts", () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const retireScope = (queryClient: QueryClient) => {
    act(() => {
      const claim = createContextPublicationClaim();
      claimContextPublication(queryClient, claim, "bootstrap");
      publishContextPublication(queryClient, claim, {
        user: {
          id: "user-1",
          name: "Tester",
          email: "test@example.test",
          emailVerified: true,
          twoFactorEnabled: false,
        },
        organizations: [],
        lastActiveTenantId: OTHER,
      });
    });
  };
  const seeded = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, {
      user: {
        id: "user-1",
        name: "Tester",
        email: "test@example.test",
        emailVerified: true,
        twoFactorEnabled: false,
      },
      organizations: [],
      lastActiveTenantId: ORG_A,
    });
    return queryClient;
  };
  const lateCreated = () => {
    const late = Promise.withResolvers<{ export: AuditExportRecord }>();
    let signal: AbortSignal | undefined;
    createMock.mockImplementation((_org, _body, given) => {
      signal = given;
      return late.promise;
    });
    return { late, signalOf: () => signal };
  };
  const exportsKey = ["tenant", "audit-log", "exports", ORG_A];

  it("aborts the dialog's POST when the scope retires and shows nothing afterwards", async () => {
    const user = userEvent.setup();
    const queryClient = seeded();
    open({ queryClient });
    const dialog = await openDialog(user);
    const { late, signalOf } = lateCreated();
    await user.click(within(dialog).getByTestId("audit-export-dialog-create"));
    await waitFor(() => {
      expect(signalOf()).toBeDefined();
    });
    retireScope(queryClient);
    expect(signalOf()?.aborted).toBe(true);
    late.resolve({ export: makeRecord() });
    await act(() => Promise.resolve());
    expect(screen.queryByTestId("audit-export-requested-notice")).toBeNull();
    expect(
      screen.queryByTestId("audit-export-announcement")?.textContent ?? "",
    ).toBe("");
    expect(queryClient.getQueryData(exportsKey)).not.toMatchObject({
      inProgress: true,
    });
  });

  it("aborts the POST when the page unmounts", async () => {
    const user = userEvent.setup();
    const view = open();
    const dialog = await openDialog(user);
    const { late, signalOf } = lateCreated();
    await user.click(within(dialog).getByTestId("audit-export-dialog-create"));
    await waitFor(() => {
      expect(signalOf()).toBeDefined();
    });
    view.unmount();
    expect(signalOf()?.aborted).toBe(true);
    late.resolve({ export: makeRecord() });
    await act(() => Promise.resolve());
    expect(view.queryClient.getQueryData(exportsKey)).not.toMatchObject({
      inProgress: true,
    });
  });

  it("aborts a ขอใหม่ POST when the scope retires and writes nothing", async () => {
    const user = userEvent.setup();
    const queryClient = seeded();
    open({
      queryClient,
      rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
    });
    await sectionHeading();
    const { late, signalOf } = lateCreated();
    await user.click(
      within(row(DEFAULT_JOB_ID)).getByTestId("audit-export-job-retry"),
    );
    await waitFor(() => {
      expect(signalOf()).toBeDefined();
    });
    retireScope(queryClient);
    expect(signalOf()?.aborted).toBe(true);
    late.resolve({
      export: makeRecord({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    });
    await act(() => Promise.resolve());
    expect(queryClient.getQueryData(exportsKey)).not.toMatchObject({
      inProgress: true,
    });
  });

  it("aborts a download when the page unmounts and shows no error", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const view = open({
      rows: [
        makeRecord({ status: "ready", expiresAt: "2026-10-04T07:07:30.000Z" }),
      ],
    });
    await sectionHeading();
    let signal: AbortSignal | undefined;
    const late = Promise.withResolvers<{
      blob: Blob;
      filename: string | null;
    }>();
    downloadMock.mockImplementation((_org, _id, given) => {
      signal = given;
      return late.promise;
    });
    await user.click(
      within(row(DEFAULT_JOB_ID)).getByTestId("audit-export-job-download"),
    );
    await waitFor(() => {
      expect(signal).toBeDefined();
    });
    view.unmount();
    expect(signal?.aborted).toBe(true);
    late.resolve({ blob: new Blob(["a"]), filename: "x.csv" });
    await act(() => Promise.resolve());
    expect(click).not.toHaveBeenCalled();
  });
});

describe("hash and Organization scope", () => {
  it("focuses the section heading when opened with #my-exports", async () => {
    open({
      hash: "#my-exports",
      rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
    });
    const heading = await sectionHeading();
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  it("opens at the top for an auditor, whose section does not render", async () => {
    open({ role: "auditor", hash: "#my-exports" });
    await screen.findByTestId("audit-events-table");
    expect(screen.queryByTestId("audit-export-jobs-title")).toBeNull();
    expect(document.body).toHaveFocus();
  });

  it("removes origin export rows after the active organization changes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const confirmed = {
      user: {
        id: "user-1",
        name: "Tester",
        email: "test@example.test",
        emailVerified: true,
        twoFactorEnabled: false,
      },
      organizations: [],
      lastActiveTenantId: ORG_A,
    };
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, confirmed);
    open({
      queryClient,
      rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
    });
    await sectionHeading();
    act(() => {
      const claim = createContextPublicationClaim();
      claimContextPublication(queryClient, claim, "bootstrap");
      publishContextPublication(queryClient, claim, {
        ...confirmed,
        lastActiveTenantId: "22222222-2222-4222-8222-222222222222",
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("audit-export-jobs-table")).toBeNull();
    });
    expect(screen.queryByTestId("audit-export-open")).toBeNull();
  });
});
