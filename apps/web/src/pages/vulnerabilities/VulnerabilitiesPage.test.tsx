import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  advanceVulnerabilityRun,
  downloadSystemExport,
  fetchNewVulnerabilities,
  fetchPriority,
  fetchSample,
  fetchVulnerabilities,
  putTriage,
  startVulnerabilityRun,
} from "../../lib/api/vulnerabilities";
import { TERM_TIPS, type Term } from "./terms";
import {
  AT,
  BASE,
  component,
  DOCUMENT_CODE,
  finding,
  fresh,
  list,
  MAPPING,
  newItem,
  ORG,
  PROJECT,
  priority,
  renderAt,
  run,
  RUN,
  SYSTEM,
  SYSTEM_2,
} from "./vulnerabilities-test-support";

vi.mock("../../lib/tenant/useLeaveOnOrganizationSwitch", () => ({
  useLeaveOnOrganizationSwitch: () => false,
}));
vi.mock("../../components/shell/useCurrentProject", () => ({
  useCurrentProject: () => ({ project: { name: "Payments Platform" } }),
}));
vi.mock("../../lib/api/vulnerabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVulnerabilities: vi.fn(),
  fetchPriority: vi.fn(),
  fetchNewVulnerabilities: vi.fn(),
  startVulnerabilityRun: vi.fn(),
  advanceVulnerabilityRun: vi.fn(),
  downloadSystemExport: vi.fn(),
  fetchSample: vi.fn(),
  putTriage: vi.fn(),
}));

const listMock = vi.mocked(fetchVulnerabilities);
const priorityMock = vi.mocked(fetchPriority);
const freshMock = vi.mocked(fetchNewVulnerabilities);
const startMock = vi.mocked(startVulnerabilityRun);
const advanceMock = vi.mocked(advanceVulnerabilityRun);
const exportMock = vi.mocked(downloadSystemExport);
const sampleMock = vi.mocked(fetchSample);
const triageMock = vi.mocked(putTriage);

beforeEach(() => {
  for (const mock of [
    listMock,
    priorityMock,
    freshMock,
    startMock,
    advanceMock,
    exportMock,
    sampleMock,
    triageMock,
  ]) {
    mock.mockReset();
  }
  listMock.mockResolvedValue(list());
  priorityMock.mockResolvedValue(priority());
  freshMock.mockResolvedValue(fresh());
  sampleMock.mockResolvedValue({ sample: null });
});

const fix = async (entry = BASE) => {
  const router = renderAt(entry);
  await screen
    .findByTestId("vuln-ranked", {}, { timeout: 3000 })
    .catch(() => null);
  return router;
};

describe("the Needs-fix view (default)", () => {
  it("opens on the ranking with rank, CVE, component, System, severity, reason badges and provisional text", async () => {
    await fix();
    const first = screen.getByTestId("vuln-item-1");
    expect(first).toHaveTextContent("CVE-2024-0001");
    expect(first).toHaveTextContent("Redis · Redis 7.2.4");
    expect(first).toHaveTextContent("Billing API");
    expect(first).toHaveTextContent("9.8 วิกฤต");
    const badges = within(screen.getByTestId("vuln-reason-1"))
      .getAllByText(/./)
      .map((node) => node.textContent);
    expect(badges).toEqual(["อยู่ใน KEV", "ภายใน", "EPSS 42%", "CVSS 9.8"]);
    // A value the feeds did not give is "ไม่ทราบ", and the place is marked provisional in text.
    const second = screen.getByTestId("vuln-item-2");
    expect(second).toHaveTextContent("ไม่ทราบ");
    expect(screen.getByTestId("vuln-provisional-2")).toHaveTextContent(
      "ชั่วคราว: ยังไม่ทราบ KEV, EPSS, CVSS",
    );
    expect(screen.getByTestId("vuln-tab-fix")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows the trust statements as on-screen text, not only in a tooltip", async () => {
    await fix();
    expect(screen.getByTestId("vuln-trust")).toHaveTextContent(
      "ข้อมูลมาจาก inventory ที่ Organization แจ้งเอง ไม่พบ CVE ไม่ได้แปลว่าปลอดภัย",
    );
    const status = screen.getByTestId("vuln-status");
    expect(status).toHaveTextContent("ตรวจล่าสุด");
    expect(status).toHaveTextContent("แหล่งข้อมูลครบ");
    // The time names its zone, as the Inventory header does.
    expect(screen.getByTestId("vuln-checked-at")).toHaveTextContent(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(screen.getByTestId("vuln-coverage")).toHaveTextContent(
      "ยังไม่ครอบคลุม 1 component · ตรวจไม่สำเร็จ 1 component",
    );
  });

  it("leaves the last-checked segment out when the run has no finish time", async () => {
    listMock.mockResolvedValue(list({ results: run({ finishedAt: null }) }));
    await fix();
    const status = screen.getByTestId("vuln-status");
    expect(status).not.toHaveTextContent("ตรวจล่าสุด");
    expect(status).toHaveTextContent("แหล่งข้อมูลครบ");
  });

  it("names the feed that is down in the status line and keeps each feed's time in the icon", async () => {
    listMock.mockResolvedValue(
      list({
        results: run({
          feeds: {
            nvd: { ok: true, at: AT },
            epss: { ok: false, at: AT },
          },
        }),
      }),
    );
    await fix();
    expect(screen.getByTestId("vuln-status")).toHaveTextContent(
      "EPSS ใช้ไม่ได้",
    );
    expect(screen.getByTestId("vuln-status")).not.toHaveTextContent(
      "แหล่งข้อมูลครบ",
    );
    const label = screen.getByTestId("vuln-feeds").getAttribute("aria-label");
    expect(label).toContain("NVD");
    expect(label).toContain("OSV ไม่ได้ใช้");
    expect(label).toContain("EPSS");
    expect(label).toContain("(ใช้ไม่ได้)");
  });

  it("counts only ranked items in the four cells and a cell sets its filter in the URL", async () => {
    const router = await fix();
    expect(screen.getByTestId("vuln-tile-fix")).toHaveTextContent("2");
    expect(screen.getByTestId("vuln-tile-kev")).toHaveTextContent("1");
    // Only CVE-2024-0001 is critical or high among ranked; the backport CVE is not ranked.
    expect(screen.getByTestId("vuln-tile-severe")).toHaveTextContent("1");
    expect(screen.getByTestId("vuln-tile-new")).toHaveTextContent("0");

    await userEvent.click(
      within(screen.getByTestId("vuln-tile-kev")).getByRole("button", {
        name: /อยู่ใน KEV/,
      }),
    );
    expect(router.state.location.search).toBe("?kev=1");
    expect(screen.queryByTestId("vuln-item-2")).toBeNull();
    await userEvent.click(
      within(screen.getByTestId("vuln-tile-severe")).getByRole("button"),
    );
    expect(router.state.location.search).toBe("?kev=1&severity=critical-high");
  });

  it("restores the view and every filter from the URL", async () => {
    priorityMock.mockResolvedValue(
      priority({
        items: [...priority().items],
      }),
    );
    await fix(
      `${BASE}?system=${SYSTEM}&kev=1&severity=critical-high&untriaged=1`,
    );
    expect(screen.getByTestId("vuln-item-1")).toBeInTheDocument();
    expect(screen.queryByTestId("vuln-item-2")).toBeNull();
    expect(screen.getByTestId("vuln-filter-kev")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("vuln-filter-untriaged")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("vuln-filter-new")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("vuln-filter-system")).toHaveValue(SYSTEM);
  });

  it("ignores a System the Project does not have instead of showing an empty list", async () => {
    await fix(`${BASE}?system=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9`);
    expect(screen.getByTestId("vuln-item-1")).toBeInTheDocument();
    expect(screen.getByTestId("vuln-filter-system")).toHaveValue("");
  });

  it("filters by System through the select and writes it to the URL", async () => {
    listMock.mockResolvedValue(
      list({
        components: [
          ...list().components,
          component({
            systemId: SYSTEM_2,
            system: "HR Portal",
            product: "Quiet",
          }),
        ],
      }),
    );
    priorityMock.mockResolvedValue(
      priority({
        items: [...priority().items],
      }),
    );
    const router = await fix();
    await userEvent.selectOptions(
      screen.getByTestId("vuln-filter-system"),
      SYSTEM_2,
    );
    expect(router.state.location.search).toBe(`?system=${SYSTEM_2}`);
    expect(screen.getByTestId("vuln-no-match")).toHaveTextContent(
      "ไม่มีรายการตามตัวกรอง",
    );
  });

  it("tells a list with no match apart from a list with nothing found, and clears the filters", async () => {
    const router = await fix(`${BASE}?kev=1&untriaged=1&new=1`);
    expect(screen.getByTestId("vuln-no-match")).toHaveTextContent(
      "ไม่มีรายการตามตัวกรอง",
    );
    expect(screen.queryByTestId("vuln-none")).toBeNull();
    await userEvent.click(screen.getByTestId("vuln-filter-clear"));
    expect(router.state.location.search).toBe("");
    expect(screen.getByTestId("vuln-item-1")).toBeInTheDocument();
  });

  it("puts the clear button inside the no-match block", async () => {
    await fix(`${BASE}?kev=1&untriaged=1&new=1`);
    expect(
      within(screen.getByTestId("vuln-no-match")).getByTestId(
        "vuln-filter-clear",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the clear button in the filter row when filtered rows remain", async () => {
    await fix(`${BASE}?kev=1`);
    expect(screen.queryByTestId("vuln-no-match")).toBeNull();
    expect(screen.getByTestId("vuln-filter-clear")).toBeInTheDocument();
  });

  it("says how many rows a filter shows out of all, and leaves the tiles counting the whole ranking", async () => {
    await fix(`${BASE}?kev=1`);
    const shown = screen.getByTestId("vuln-shown");
    expect(shown).toHaveTextContent("1");
    expect(shown).toHaveTextContent("2");
    expect(screen.getByTestId("vuln-tile-fix")).toHaveTextContent("2");
    expect(screen.getByTestId("vuln-tile-kev")).toHaveTextContent("1");
  });

  it("shows no count line while no filter is set", async () => {
    await fix();
    expect(screen.queryByTestId("vuln-shown")).toBeNull();
  });

  it("says nothing was found as of the last scan without calling it safe, and keeps the coverage line", async () => {
    priorityMock.mockResolvedValue(priority({ items: [] }));
    await fix();
    expect(screen.getByTestId("vuln-none")).toHaveTextContent(
      "ไม่มี CVE ที่ยังพบ ณ การตรวจล่าสุด ไม่ได้หมายความว่าปลอดภัย",
    );
    expect(screen.queryByTestId("vuln-no-match")).toBeNull();
    expect(screen.getByTestId("vuln-coverage")).toBeInTheDocument();
  });

  it("links the coverage line to the By-System view", async () => {
    const router = await fix();
    await userEvent.click(screen.getByTestId("vuln-coverage-link"));
    expect(router.state.location.search).toBe("?view=systems");
  });

  it("says there is no result yet, and gives only an admin the run button", async () => {
    listMock.mockResolvedValue(list({ run: null, results: null }));
    priorityMock.mockResolvedValue(priority({ items: [], checkedAt: null }));
    renderAt(BASE);
    expect(await screen.findByTestId("vuln-no-results")).toHaveTextContent(
      "ยังไม่มีผลการตรวจ",
    );
    expect(screen.getByTestId("vuln-run")).toBeInTheDocument();
  });

  it("gives a member no run button and no link to the sample page", async () => {
    listMock.mockResolvedValue(list({ canManage: false }));
    await fix();
    expect(screen.queryByTestId("vuln-run")).toBeNull();
    expect(screen.queryByTestId("vuln-sample-link")).toBeNull();
  });

  it("gives a Project admin the run button and the link to the sample page, and no primary button in the header", async () => {
    await fix();
    expect(screen.getByTestId("vuln-sample-link")).toHaveAttribute(
      "href",
      `${BASE}/sample`,
    );
    const header = screen.getByTestId("page-header");
    expect(within(header).queryByTestId("vuln-run")).toBeNull();
    for (const control of within(header).getAllByRole("link")) {
      expect(control.className).not.toMatch(/bg-primary(?!-)/);
    }
    expect(screen.getByTestId("vuln-run")).toBeInTheDocument();
  });

  it("shows loading and then an error with a retry", async () => {
    priorityMock.mockRejectedValueOnce(new ApiError("X", "x", 500));
    renderAt(BASE);
    expect(
      await screen.findByText("ทำรายการไม่สำเร็จ โปรดลองใหม่"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByTestId("vuln-item-1")).toBeInTheDocument();
  });

  it("shows the denied state with no retry when the read is refused", async () => {
    priorityMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "x", 403));
    renderAt(BASE);

    expect(await screen.findByTestId("vuln-denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).toBeNull();
  });

  it("shows the empty state of a Project with no inventory, with the Import link only for an admin", async () => {
    listMock.mockResolvedValue(
      list({
        components: [],
        summary: {
          components: 0,
          cves: 0,
          kev: 0,
          backport: 0,
          notCovered: 0,
          checkFailed: 0,
        },
      }),
    );
    priorityMock.mockResolvedValue(priority({ items: [] }));
    renderAt(BASE);
    const empty = await screen.findByTestId("vuln-no-inventory");
    expect(within(empty).getByRole("link")).toHaveAttribute(
      "href",
      `/organizations/${ORG}/projects/${PROJECT}/inventory/import`,
    );
  });

  it("shows a member the Import hint without the link", async () => {
    listMock.mockResolvedValue(
      list({
        canManage: false,
        components: [],
        summary: {
          components: 0,
          cves: 0,
          kev: 0,
          backport: 0,
          notCovered: 0,
          checkFailed: 0,
        },
      }),
    );
    priorityMock.mockResolvedValue(priority({ items: [] }));
    renderAt(BASE);
    const empty = await screen.findByTestId("vuln-no-inventory");
    expect(within(empty).queryByRole("link")).toBeNull();
  });
});

describe("the false-positive warning", () => {
  const over = {
    reviewed: 40,
    falsePositives: 10,
    falsePositiveRate: 0.25,
    overLimit: true,
  };

  it("shows every member the rate and the limit as numbers once the limit is passed", async () => {
    listMock.mockResolvedValue(list({ canManage: false, falsePositive: over }));
    await fix();
    const warning = screen.getByTestId("vuln-fp-warning");
    expect(warning).toHaveTextContent("25%");
    expect(warning).toHaveTextContent("เกินเกณฑ์ 20%");
    expect(warning).toHaveTextContent("ตรวจแล้ว 40 รายการ");
    expect(warning).toHaveTextContent("อย่างน้อย 30 รายการ");
    expect(warning).toHaveTextContent(
      "อาจมี CVE ที่ไม่เกี่ยวข้องมากกว่าที่ยอมรับ",
    );
  });

  it("stays silent under the limit and before any sample", async () => {
    listMock.mockResolvedValue(
      list({
        falsePositive: { ...over, falsePositiveRate: 0.2, overLimit: false },
      }),
    );
    await fix();
    expect(screen.queryByTestId("vuln-fp-warning")).toBeNull();
  });
});

describe("the new-in-30-days filter", () => {
  const known = (cve: string, overrides = {}) => newItem(cve, overrides);

  function seed() {
    priorityMock.mockResolvedValue(
      priority({
        items: priority().items,
        notAffected: [
          {
            mappingId: MAPPING,
            triage: {
              status: "not_affected",
              reason: "ไม่ได้เปิดใช้ module",
              changedBy: "Somchai",
              changedAt: AT,
            },
            systemId: SYSTEM,
            system: "Billing API",
            vendor: "Redis",
            product: "Redis",
            version: "7.2.4",
            exposure: "Internal",
            cveId: "CVE-2024-0005",
            cvssScore: 5,
            cvssSeverity: "medium",
            epss: 0.1,
            kev: false,
          },
        ],
      }),
    );
    freshMock.mockResolvedValue(
      fresh({
        items: [
          known("CVE-2024-0001", { kev: true, cvssSeverity: "critical" }),
          known("CVE-2024-0005", { cvssSeverity: "medium" }),
          known("CVE-2024-7777", { stillFound: false, cvssSeverity: "low" }),
          known("CVE-2024-8888", { stillFound: null, cvssSeverity: "low" }),
        ],
      }),
    );
  }

  it("keeps every item of the old page under the filter: ranked with a badge, not affected, gone and unknown, with the same total", async () => {
    seed();
    await fix(`${BASE}?new=1`);
    expect(screen.getByTestId("vuln-new-total")).toHaveTextContent(
      "CVE ใหม่ใน 30 วัน 4 รายการ",
    );
    // Ranked: only the one that is new, badged, with its first-seen time.
    expect(screen.getByTestId("vuln-item-1")).toHaveTextContent(
      "CVE-2024-0001",
    );
    expect(screen.getByTestId("vuln-item-1")).toHaveTextContent("ใหม่");
    expect(screen.getByTestId("vuln-item-1")).toHaveTextContent("พบครั้งแรก");
    expect(screen.queryByTestId("vuln-item-2")).toBeNull();
    // The not-affected one stays in its folded group, with its count.
    expect(screen.getByTestId("vuln-not-affected")).toHaveTextContent(
      "ไม่ได้รับผลกระทบ (VEX) 1 รายการ",
    );
    expect(screen.getByTestId("vuln-new-gone")).toHaveTextContent(
      "ใหม่แต่ไม่พบแล้ว 1 รายการ",
    );
    expect(screen.getByTestId("vuln-new-unknown")).toHaveTextContent(
      "ใหม่แต่ยังไม่ทราบสถานะ 1 รายการ",
    );
    await userEvent.click(
      within(screen.getByTestId("vuln-new-gone")).getByText(/ใหม่แต่ไม่พบแล้ว/),
    );
    expect(screen.getByTestId("vuln-new-gone-CVE-2024-7777")).toBeVisible();
    // 1 ranked + 1 not affected + 1 gone + 1 unknown = the 4 entries of the new-CVE list.
  });

  it("counts a still-found entry that has no row as not known, never drops it", async () => {
    seed();
    freshMock.mockResolvedValue(
      fresh({ items: [known("CVE-2024-4242", { stillFound: true })] }),
    );
    await fix(`${BASE}?new=1`);
    expect(screen.getByTestId("vuln-new-unknown")).toHaveTextContent(
      "ใหม่แต่ยังไม่ทราบสถานะ 1 รายการ",
    );
  });

  it("badges every row of a component that sits in two Systems from one new-CVE entry", async () => {
    const [ranked] = priority().items;
    if (ranked === undefined) throw new Error("fixture");
    priorityMock.mockResolvedValue(
      priority({
        items: [
          ranked,
          {
            ...ranked,
            rank: 2,
            systemId: SYSTEM_2,
            system: "HR Portal",
          },
        ],
      }),
    );
    freshMock.mockResolvedValue(fresh({ items: [known("CVE-2024-0001")] }));
    await fix(`${BASE}?new=1`);
    expect(screen.getByTestId("vuln-item-1")).toHaveTextContent("ใหม่");
    expect(screen.getByTestId("vuln-item-2")).toHaveTextContent("ใหม่");
    expect(screen.getByTestId("vuln-new-total")).toHaveTextContent("1 รายการ");
  });

  it("says when the oldest were left out, and shows the five warnings of the old page", async () => {
    seed();
    freshMock.mockResolvedValue(
      fresh({
        truncated: true,
        warnings: [
          "no_scan",
          "run_failed",
          "units_failed",
          "feed_down",
          "stale",
        ],
        items: [known("CVE-2024-0001")],
      }),
    );
    await fix(`${BASE}?new=1`);
    expect(screen.getByTestId("vuln-new-truncated")).toHaveTextContent(
      "แสดงเฉพาะรายการล่าสุด",
    );
    for (const warning of [
      "no_scan",
      "run_failed",
      "units_failed",
      "feed_down",
      "stale",
    ]) {
      expect(screen.getByTestId(`vuln-new-warning-${warning}`)).toBeVisible();
    }
  });

  it("does not repeat a run alert the new-CVE warnings already give", async () => {
    seed();
    listMock.mockResolvedValue(
      list({ run: run({ status: "failed", failedUnits: 1 }) }),
    );
    freshMock.mockResolvedValue(
      fresh({ warnings: ["run_failed"], items: [known("CVE-2024-0001")] }),
    );
    await fix(`${BASE}?new=1`);
    expect(screen.getByTestId("vuln-new-warning-run_failed")).toBeVisible();
    expect(screen.queryByTestId("vuln-run-failed")).toBeNull();
  });

  it("does not say none were found while a warning holds", async () => {
    priorityMock.mockResolvedValue(priority({ items: [], notAffected: [] }));
    freshMock.mockResolvedValue(fresh({ warnings: ["stale"] }));
    await fix(`${BASE}?new=1`);
    expect(screen.getByTestId("vuln-no-match")).toBeInTheDocument();
    expect(screen.queryByTestId("vuln-new-none")).toBeNull();
  });

  it("says none were new as of the last scan, without calling that safe, when nothing warns", async () => {
    await fix(`${BASE}?new=1`);
    expect(screen.getByTestId("vuln-new-none")).toHaveTextContent(
      "ไม่พบ CVE ใหม่ใน 30 วันที่ผ่านมา ณ การตรวจล่าสุด ไม่ได้หมายความว่าปลอดภัย",
    );
  });
});

describe("the By-System view", () => {
  it("opens from the tab and the URL, and shows one badge per component state", async () => {
    const router = await fix();
    await userEvent.click(screen.getByTestId("vuln-tab-systems"));
    expect(router.state.location.search).toBe("?view=systems");
    const system = await screen.findByTestId(`vuln-system-${SYSTEM}`);
    expect(system).toHaveTextContent("Billing API");
    expect(system).toHaveTextContent("พบ CVE 2 รายการ · อยู่ใน KEV 1 รายการ");
    const at = within(screen.getByTestId("vuln-none-found"));
    expect(at.getByText("ไม่พบ CVE")).toBeInTheDocument();
    expect(screen.getByTestId("vuln-feed-time-nvd")).toBeInTheDocument();
    expect(screen.queryByTestId("vuln-feed-time-osv")).toBeNull();
    expect(screen.getByTestId("vuln-check-failed")).toHaveTextContent(
      "ตรวจไม่สำเร็จ",
    );
    expect(screen.getByTestId("vuln-check-failed")).toHaveTextContent(
      "NVD ใช้ไม่ได้",
    );
    expect(screen.getByTestId("vuln-not-covered")).toHaveTextContent(
      "ยังไม่ครอบคลุม",
    );
    expect(
      within(screen.getByTestId("vuln-not-covered")).getByRole("link"),
    ).toHaveAttribute(
      "href",
      `/organizations/${ORG}/projects/${PROJECT}/inventory/mappings`,
    );
    expect(screen.getByText("รอตรวจ")).toBeInTheDocument();
    expect(screen.getByTestId("vuln-tab-systems")).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The ranking is not read for this view.
    expect(screen.queryByTestId("vuln-tiles")).toBeNull();
  });

  it("dates a component with no CVE by the time of each feed it checked, not by when the run finished", async () => {
    listMock.mockResolvedValue(
      list({
        results: run({
          finishedAt: "2026-11-21T10:00:00.000Z",
          feeds: {
            nvd: { ok: true, at: "2026-11-20T08:30:00.000Z" },
            osv: { ok: true, at: "2026-11-19T08:30:00.000Z" },
          },
        }),
        components: [component({ checkedSources: ["nvd", "osv"] })],
      }),
    );
    await fix(`${BASE}?view=systems`);
    expect(await screen.findByTestId("vuln-feed-time-nvd")).toHaveTextContent(
      "2026-11-20",
    );
    expect(screen.getByTestId("vuln-feed-time-osv")).toHaveTextContent(
      "2026-11-19",
    );
    expect(screen.getByTestId("vuln-none-found")).not.toHaveTextContent(
      "2026-11-21",
    );
  });

  it("says unknown, not a blank time, for a checked source whose feed has no time", async () => {
    listMock.mockResolvedValue(
      list({
        results: run({ feeds: {} }),
        components: [component({ checkedSources: ["nvd"] })],
      }),
    );
    await fix(`${BASE}?view=systems`);
    expect(await screen.findByTestId("vuln-feed-time-nvd")).toHaveTextContent(
      "ไม่ทราบ",
    );
  });

  it("shows how many of a System's and a component's CVEs are marked not affected, only when some are", async () => {
    await fix(`${BASE}?view=systems`);
    await screen.findByTestId(`vuln-system-${SYSTEM}`);
    expect(screen.queryByTestId("vuln-not-affected-count")).toBeNull();
    expect(
      screen.queryByTestId(`vuln-system-not-affected-${SYSTEM}`),
    ).toBeNull();
  });

  it("counts a not-affected CVE in the found total and says so next to it", async () => {
    listMock.mockResolvedValue(
      list({
        components: [
          component({
            state: "findings",
            findings: [
              finding("CVE-2024-0001"),
              finding("CVE-2024-0002", {
                triage: {
                  status: "not_affected",
                  reason: "x",
                  changedBy: "A",
                  changedAt: AT,
                },
              }),
            ],
          }),
        ],
      }),
    );
    await fix(`${BASE}?view=systems`);
    expect(
      await screen.findByTestId("vuln-not-affected-count"),
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId(`vuln-system-not-affected-${SYSTEM}`),
    ).toHaveTextContent("1");
  });

  it("folds a System with its header button, open at first, and keeps its Excel button outside the fold", async () => {
    await fix(`${BASE}?view=systems`);
    const toggle = await screen.findByTestId(`vuln-system-toggle-${SYSTEM}`);
    // The System name is a level-3 heading whose button folds the group.
    expect(
      screen.getByRole("heading", { level: 2, name: /Billing API/ }),
    ).toContainElement(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Billing API");
    expect(toggle).toHaveTextContent("พบ CVE 2 รายการ · อยู่ใน KEV 1 รายการ");
    const redis = screen.getByTestId(`vuln-component-${SYSTEM}-Redis-7.2.4`);
    expect(redis).toBeVisible();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(redis).not.toBeVisible();
    expect(screen.getByTestId(`vuln-export-${SYSTEM}`)).toBeVisible();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(redis).toBeVisible();
  });

  it("expands the found CVEs with severity, EPSS, KEV, source and VEX, and 'ไม่ทราบ' for missing values", async () => {
    await fix(`${BASE}?view=systems`);
    const redis = await screen.findByTestId(
      `vuln-component-${SYSTEM}-Redis-7.2.4`,
    );
    await userEvent.click(within(redis).getByText("พบ 2 CVE"));
    const first = within(redis).getByTestId("vuln-finding-CVE-2024-0001");
    expect(first).toHaveTextContent("9.8 วิกฤต");
    expect(first).toHaveTextContent("42%");
    expect(first).toHaveTextContent("อยู่ใน KEV");
    expect(first).toHaveTextContent("NVD, OSV");
    expect(first).toHaveTextContent("ยังไม่ triage");
    const second = within(redis).getByTestId("vuln-finding-CVE-2024-0002");
    expect(second.textContent.match(/ไม่ทราบ/g)).toHaveLength(3);
    // The backport CVE is not in this list.
    expect(
      within(redis).queryByTestId("vuln-finding-CVE-2024-0003"),
    ).toBeNull();
  });

  it("folds backport CVEs into one expandable line with advisory and reason", async () => {
    await fix(`${BASE}?view=systems`);
    const redis = await screen.findByTestId(
      `vuln-component-${SYSTEM}-Redis-7.2.4`,
    );
    const line = within(redis).getByText(/กรองเป็น backport 1 รายการ/);
    await userEvent.click(line);
    const row = within(redis).getByTestId("vuln-backport-CVE-2024-0003");
    expect(row).toHaveTextContent("advisory UBUNTU-CVE-2024-0003");
    expect(row).toHaveTextContent("fixed in openssl 3.0.2-0ubuntu1.12");
  });

  it("labels a component with only backports, and flags a partial backport lookup", async () => {
    listMock.mockResolvedValue(
      list({
        components: [
          component({
            state: "backport_only",
            backportPartial: true,
            findings: [
              finding("CVE-2024-0003", {
                backport: true,
                advisoryId: "UBUNTU-CVE-2024-0003",
                backportReason: "fixed",
              }),
            ],
          }),
        ],
      }),
    );
    await fix(`${BASE}?view=systems`);
    expect(await screen.findByText("พบเฉพาะ backport")).toBeInTheDocument();
    expect(screen.getByTestId("vuln-backport-partial")).toHaveTextContent(
      "ตรวจ backport ไม่ครบ",
    );
  });

  it("downloads one System's findings through the API client under the name the server gives", async () => {
    exportMock.mockResolvedValue({
      blob: new Blob(["x"]),
      filename: "vulnerabilities.xlsx",
    });
    const url = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: url, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    await fix(`${BASE}?view=systems`);
    await userEvent.click(await screen.findByTestId(`vuln-export-${SYSTEM}`));
    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledWith(ORG, PROJECT, SYSTEM);
    });
    await waitFor(() => {
      expect(click).toHaveBeenCalled();
    });
    click.mockRestore();
  });

  it("says a download failed next to its button and keeps the findings", async () => {
    exportMock.mockRejectedValue(new ApiError("X", "x", 500));
    await fix(`${BASE}?view=systems`);
    await userEvent.click(await screen.findByTestId(`vuln-export-${SYSTEM}`));
    const error = await screen.findByTestId(`vuln-export-error-${SYSTEM}`);
    expect(error).toBeVisible();
    expect(error).toHaveAttribute("role", "alert");
    expect(screen.getByTestId(`vuln-system-${SYSTEM}`)).toBeVisible();
  });

  it("announces the wait while the Excel file is built", async () => {
    let finish: (value: { blob: Blob; filename: string }) => void = () =>
      undefined;
    exportMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:x"),
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    await fix(`${BASE}?view=systems`);
    const button = await screen.findByTestId(`vuln-export-${SYSTEM}`);
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByTestId(`vuln-export-status-${SYSTEM}`),
    ).not.toBeEmptyDOMElement();
    finish({ blob: new Blob(["x"]), filename: "v.xlsx" });
    await waitFor(() => {
      expect(
        screen.getByTestId(`vuln-export-status-${SYSTEM}`),
      ).toBeEmptyDOMElement();
    });
    click.mockRestore();
  });

  it("keeps the trust statement on screen in this view too", async () => {
    await fix(`${BASE}?view=systems`);
    expect(await screen.findByTestId("vuln-trust")).toHaveTextContent(
      "ไม่พบ CVE ไม่ได้แปลว่าปลอดภัย",
    );
  });
});

describe("an error only counts in the view that reads it", () => {
  it.each([
    [
      "the ranking",
      () => priorityMock.mockRejectedValue(new ApiError("X", "x", 500)),
    ],
    [
      "the new-CVE list",
      () => freshMock.mockRejectedValue(new ApiError("X", "x", 500)),
    ],
  ])(
    "shows the By-System view when %s failed on the Needs-fix view",
    async (_name, fail) => {
      fail();
      renderAt(BASE);
      expect(
        await screen.findByText("ทำรายการไม่สำเร็จ โปรดลองใหม่"),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByTestId("vuln-tab-systems"));
      expect(
        await screen.findByTestId(`vuln-system-${SYSTEM}`),
      ).toBeInTheDocument();
      expect(screen.getByTestId(`vuln-export-${SYSTEM}`)).toBeInTheDocument();
      expect(screen.queryByText("ทำรายการไม่สำเร็จ โปรดลองใหม่")).toBeNull();
    },
  );

  it("shows the error of the list in the By-System view", async () => {
    listMock.mockRejectedValue(new ApiError("X", "x", 500));
    renderAt(`${BASE}?view=systems`);
    expect(
      await screen.findByText("ทำรายการไม่สำเร็จ โปรดลองใหม่"),
    ).toBeInTheDocument();
  });
});

describe("terms and document codes", () => {
  const terms: Term[] = [
    "kev",
    "epss",
    "cvss",
    "vex",
    "notCovered",
    "backport",
  ];

  it("gives each term an icon whose tooltip and aria-label are the same Thai sentence", async () => {
    await fix();
    const seen = new Set<Term>();
    for (const term of terms) {
      for (const button of screen.queryAllByTestId(`term-${term}`)) {
        expect(button).toHaveAttribute("aria-label", TERM_TIPS[term]);
        seen.add(term);
      }
    }
    expect([...seen].sort()).toEqual([
      "cvss",
      "epss",
      "kev",
      "notCovered",
      "vex",
    ]);
    const kev = screen.getAllByTestId("term-kev")[0];
    if (kev === undefined) throw new Error("no KEV icon");
    await userEvent.hover(kev);
    const bubble = await screen.findByTestId("tooltip");
    expect(bubble).toHaveTextContent(TERM_TIPS.kev);
    // Read from the DOM, not from the shared constant: icon and bubble say the same sentence.
    expect(bubble.textContent).toBe(kev.getAttribute("aria-label"));
    await userEvent.unhover(kev);
    await userEvent.tab();
    await userEvent.tab();
  });

  it("covers every term in the By-System view, backport included", async () => {
    await fix(`${BASE}?view=systems`);
    const redis = await screen.findByTestId(
      `vuln-component-${SYSTEM}-Redis-7.2.4`,
    );
    await userEvent.click(within(redis).getByText("พบ 2 CVE"));
    for (const term of terms) {
      const icons = screen.getAllByTestId(`term-${term}`);
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(icon).toHaveAttribute("aria-label", TERM_TIPS[term]);
      }
    }
  });

  it("shows no document code on either view, in text or in a tooltip", async () => {
    listMock.mockResolvedValue(
      list({
        falsePositive: {
          reviewed: 40,
          falsePositives: 10,
          falsePositiveRate: 0.25,
          overLimit: true,
        },
      }),
    );
    await fix();
    expect(document.body.textContent).not.toMatch(DOCUMENT_CODE);
    for (const label of document.querySelectorAll("[aria-label]")) {
      expect(label.getAttribute("aria-label")).not.toMatch(DOCUMENT_CODE);
    }
    await userEvent.click(screen.getByTestId("vuln-tab-systems"));
    await screen.findByTestId(`vuln-system-${SYSTEM}`);
    expect(document.body.textContent).not.toMatch(DOCUMENT_CODE);
    for (const tip of Object.values(TERM_TIPS)) {
      expect(tip).not.toMatch(DOCUMENT_CODE);
    }
  });
});

describe("VEX in the list", () => {
  it("gives an admin the segmented control on a ranked row and a member only the status", async () => {
    await fix();
    const row = screen.getByTestId("vuln-item-1");
    expect(
      within(row).getByRole("button", {
        name: "สถานะ VEX ของ CVE-2024-0001: ยังไม่ triage",
      }),
    ).toHaveAttribute("aria-haspopup", "menu");
  });

  it("shows a member the status and no control", async () => {
    listMock.mockResolvedValue(list({ canManage: false }));
    await fix();
    expect(screen.getByTestId("vuln-item-1")).toHaveTextContent(
      "ยังไม่ triage",
    );
    expect(screen.queryByRole("button", { name: /สถานะ VEX/ })).toBeNull();
  });

  it("keeps an open reason editor on its own finding when an earlier finding leaves the ranking", async () => {
    const [one, two] = priority().items;
    if (one === undefined || two === undefined) throw new Error("fixture");
    await fix();
    await userEvent.click(
      within(screen.getByTestId("vuln-item-2")).getByRole("button", {
        name: /สถานะ VEX ของ CVE-2024-0002/,
      }),
    );
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: "ไม่ได้รับผลกระทบ" }),
    );
    await userEvent.type(screen.getByRole("textbox"), "เหตุผลของข้อสอง");
    // Marking the first finding affected saves, the page reads again, and the first one
    // (now not affected elsewhere) leaves the ranking: the second becomes rank 1.
    triageMock.mockResolvedValue({
      status: "affected",
      reason: null,
      changedBy: "A",
      changedAt: AT,
    });
    priorityMock.mockResolvedValue(
      priority({
        items: [{ ...two, rank: 1 }],
        notAffected: [
          {
            ...one,
            triage: {
              status: "not_affected",
              reason: "x",
              changedBy: "A",
              changedAt: AT,
            },
          },
        ],
      }),
    );
    await userEvent.click(
      within(screen.getByTestId("vuln-item-1")).getByRole("button", {
        name: /สถานะ VEX ของ CVE-2024-0001/,
      }),
    );
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: "ได้รับผลกระทบ" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("vuln-item-1")).toHaveTextContent(
        "CVE-2024-0002",
      );
    });
    expect(screen.getByRole("textbox")).toHaveValue("เหตุผลของข้อสอง");
    expect(
      within(screen.getByTestId("vuln-item-1")).getByRole("textbox"),
    ).toBeInTheDocument();
  });

  it("lists a not-affected CVE in the folded group with its reason and a control for an admin", async () => {
    const [one] = priority().items;
    if (one === undefined) throw new Error("fixture");
    priorityMock.mockResolvedValue(
      priority({
        items: [],
        notAffected: [
          {
            ...one,
            triage: {
              status: "not_affected",
              reason: "ไม่ได้เปิดใช้ module",
              changedBy: "Somchai",
              changedAt: AT,
            },
          },
        ],
      }),
    );
    await fix();
    const group = screen.getByTestId("vuln-not-affected");
    expect(group).toHaveTextContent("ไม่ได้รับผลกระทบ (VEX) 1 รายการ");
    await userEvent.click(within(group).getByText(/ไม่ได้รับผลกระทบ \(VEX\)/));
    expect(
      within(screen.getByTestId("vuln-not-affected-CVE-2024-0001")).getByRole(
        "button",
        { name: "สถานะ VEX ของ CVE-2024-0001: ไม่ได้รับผลกระทบ" },
      ),
    ).toBeVisible();
    expect(
      screen.getByTestId(`triage-reason-text-CVE-2024-0001-${MAPPING}-7.2.4`),
    ).toHaveTextContent("เหตุผล: ไม่ได้เปิดใช้ module");
  });
});

describe("running a check", () => {
  const running = () =>
    run({ status: "running", finishedAt: null, doneUnits: 0 });

  it("starts a run on request", async () => {
    listMock.mockResolvedValueOnce(list());
    listMock.mockResolvedValue(list({ run: running() }));
    startMock.mockResolvedValue(running());
    advanceMock.mockImplementation(() => new Promise(() => undefined));
    renderAt(BASE);
    await userEvent.click(await screen.findByTestId("vuln-run"));
    await waitFor(() => {
      expect(startMock).toHaveBeenCalledWith(ORG, PROJECT);
    });
    expect(await screen.findByTestId("vuln-progress")).toHaveTextContent(
      "กำลังตรวจ 0 จาก 4",
    );
  });

  it("announces progress once: a status role, with no live region around it", async () => {
    listMock.mockResolvedValue(list({ run: running() }));
    advanceMock.mockImplementation(() => new Promise(() => undefined));
    renderAt(BASE);
    const progress = await screen.findByTestId("vuln-progress");
    expect(progress).toHaveAttribute("role", "status");
    expect(progress.closest("[aria-live]")).toBeNull();
  });

  it("steps a running run until it is done, then reads every list again", async () => {
    listMock.mockResolvedValueOnce(list({ run: running() }));
    listMock.mockResolvedValue(list());
    advanceMock.mockResolvedValueOnce({
      run: run({ status: "running", finishedAt: null, doneUnits: 2 }),
      retryAfterSeconds: null,
    });
    advanceMock.mockResolvedValueOnce({ run: run(), retryAfterSeconds: null });
    renderAt(BASE);
    await waitFor(() => {
      expect(advanceMock).toHaveBeenCalledTimes(2);
    });
    expect(advanceMock.mock.calls[0]?.slice(0, 3)).toEqual([ORG, PROJECT, RUN]);
    await waitFor(() => {
      expect(screen.queryByTestId("vuln-progress")).toBeNull();
    });
    await waitFor(() => {
      expect(priorityMock.mock.calls.length).toBeGreaterThan(1);
    });
    expect(freshMock.mock.calls.length).toBeGreaterThan(1);
    expect(await screen.findByTestId("vuln-finished")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("gives the progress a progressbar with the done and total units", async () => {
    listMock.mockResolvedValue(
      list({
        run: run({
          status: "running",
          finishedAt: null,
          doneUnits: 1,
          totalUnits: 4,
        }),
      }),
    );
    advanceMock.mockImplementation(() => new Promise(() => undefined));
    renderAt(BASE);
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(screen.queryByTestId("vuln-finished")).toBeNull();
  });

  it("does not announce a finished run that this page never saw running", async () => {
    await fix();
    expect(screen.queryByTestId("vuln-finished")).toBeNull();
  });

  it("stops and says why when a step fails, then steps again from the retry control", async () => {
    listMock.mockResolvedValue(list({ run: running() }));
    advanceMock.mockRejectedValueOnce(
      new ApiError("FEEDS_UNAVAILABLE", "x", 503),
    );
    advanceMock.mockResolvedValue({ run: run(), retryAfterSeconds: null });
    renderAt(BASE);
    expect(await screen.findByTestId("vuln-error")).toHaveTextContent(
      "บริการตรวจ CVE ยังไม่พร้อม",
    );
    expect(advanceMock).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("vuln-retry"));
    await waitFor(() => {
      expect(advanceMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("vuln-error")).toBeNull();
    });
  });

  it("says a failed run left the earlier results in place", async () => {
    listMock.mockResolvedValue(
      list({ run: run({ status: "failed", failedUnits: 1 }) }),
    );
    renderAt(BASE);
    expect(await screen.findByTestId("vuln-run-failed")).toHaveTextContent(
      "ผลที่แสดงเป็นของรอบก่อนหน้า",
    );
    // A standing caution is not announced assertively on every load (VULN-18).
    expect(screen.getByTestId("vuln-run-failed")).toHaveAttribute(
      "role",
      "status",
    );
    expect(advanceMock).not.toHaveBeenCalled();
  });

  it("does not step a run on behalf of a member, and follows its progress", async () => {
    listMock.mockResolvedValue(
      list({
        canManage: false,
        run: run({ status: "running", finishedAt: null, doneUnits: 1 }),
      }),
    );
    renderAt(BASE);
    expect(await screen.findByTestId("vuln-progress")).toHaveTextContent(
      "กำลังตรวจ 1 จาก 4",
    );
    expect(advanceMock).not.toHaveBeenCalled();
  });

  it("warns when a finished run left products unchecked", async () => {
    listMock.mockResolvedValue(list({ run: run({ failedUnits: 2 }) }));
    renderAt(BASE);
    expect(await screen.findByTestId("vuln-failed-units")).toHaveTextContent(
      "ตรวจไม่สำเร็จ 2 product",
    );
  });
});
