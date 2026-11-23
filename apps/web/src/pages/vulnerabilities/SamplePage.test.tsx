import type { VulnerabilitySample } from "@nightwatch/api-contract";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  drawSample,
  fetchSample,
  fetchVulnerabilities,
  reviewSampleItem,
} from "../../lib/api/vulnerabilities";
import {
  AT,
  BASE,
  DOCUMENT_CODE,
  list,
  ORG,
  PROJECT,
  renderAt,
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
  fetchSample: vi.fn(),
  drawSample: vi.fn(),
  reviewSampleItem: vi.fn(),
}));

const listMock = vi.mocked(fetchVulnerabilities);
const sampleMock = vi.mocked(fetchSample);
const drawMock = vi.mocked(drawSample);
const reviewMock = vi.mocked(reviewSampleItem);

const sample = (
  overrides: Partial<VulnerabilitySample> = {},
): VulnerabilitySample => ({
  id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  createdAt: AT,
  size: 2,
  reviewed: 0,
  falsePositives: 0,
  falsePositiveRate: null,
  items: [
    {
      position: 1,
      cveId: "CVE-2024-0001",
      component: "Redis Redis 7.2.4",
      verdict: null,
      reviewedAt: null,
    },
    {
      position: 2,
      cveId: "CVE-2024-0002",
      component: "Redis Redis 7.2.4",
      verdict: null,
      reviewedAt: null,
    },
  ],
  ...overrides,
});

beforeEach(() => {
  for (const mock of [listMock, sampleMock, drawMock, reviewMock]) {
    mock.mockReset();
  }
  listMock.mockResolvedValue(list());
  sampleMock.mockResolvedValue({ sample: null });
});

const open = () => renderAt(`${BASE}/sample`);

describe("the sample page of a Project admin", () => {
  it("says there is no sample yet, with no document code", async () => {
    open();
    expect(await screen.findByTestId("vuln-sample-empty")).toHaveTextContent(
      "ยังไม่มีผลสุ่มตรวจ",
    );
    expect(document.body.textContent).not.toMatch(DOCUMENT_CODE);
  });

  it("draws a sample, records a verdict and shows the false-positive rate", async () => {
    drawMock.mockResolvedValue({ sample: sample() });
    const [first, second] = sample().items;
    if (first === undefined || second === undefined) throw new Error("fixture");
    reviewMock.mockResolvedValueOnce({
      sample: sample({
        reviewed: 1,
        falsePositives: 1,
        falsePositiveRate: 1,
        items: [
          { ...first, verdict: "false_positive", reviewedAt: AT },
          second,
        ],
      }),
    });
    open();
    await userEvent.click(await screen.findByTestId("vuln-sample-draw"));
    await waitFor(() => {
      expect(drawMock).toHaveBeenCalledWith(ORG, PROJECT);
    });
    expect(
      await screen.findByTestId("vuln-sample-stat-rate"),
    ).toHaveTextContent("ไม่ทราบ");
    expect(await screen.findByText("สุ่มรายการแล้ว")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("vuln-sample-false_positive-1"));
    expect(reviewMock).toHaveBeenCalledWith(
      ORG,
      PROJECT,
      "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
      1,
      "false_positive",
    );
    await waitFor(() => {
      expect(screen.getByTestId("vuln-sample-stat-rate")).toHaveTextContent(
        "100%",
      );
    });
    expect(screen.getByTestId("vuln-sample-stat-fp")).toHaveTextContent("1");
    expect(
      await screen.findByText("บันทึกผลการตัดสินแล้ว"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("vuln-sample-false_positive-1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows the counts as four cells with the limit from the contract, as the only place the numbers are read", async () => {
    sampleMock.mockResolvedValue({
      sample: sample({
        reviewed: 2,
        falsePositives: 1,
        falsePositiveRate: 0.5,
      }),
    });
    open();
    const stat = async (name: string) =>
      (await screen.findByTestId(`vuln-sample-stat-${name}`)).textContent;
    expect(await stat("reviewed")).toBe("ตรวจแล้ว2 จาก 2");
    expect(await stat("fp")).toBe("false positive1");
    expect(await stat("rate")).toBe("อัตรา50%");
    expect(await stat("limit")).toBe(
      "เกณฑ์เกิน 20%เมื่อตรวจแล้วอย่างน้อย 30 รายการ",
    );
    // One reading of the numbers: no second, hidden sentence repeats them.
    expect(screen.queryByTestId("vuln-sample-rate")).toBeNull();
    expect(document.querySelector(".sr-only[data-testid]")).toBeNull();
  });

  it("lists the results as a table of CVE, Component and verdict, and puts the redraw in the section header", async () => {
    sampleMock.mockResolvedValue({ sample: sample() });
    open();
    await screen.findByTestId("vuln-sample-item-1");
    expect(
      screen.getAllByRole("columnheader").map((head) => head.textContent),
    ).toEqual(["CVE", "Component", "ผลตัดสิน"]);
    const draw = screen.getByTestId("vuln-sample-draw");
    expect(
      draw.parentElement?.contains(
        screen.getByRole("heading", { name: "ผลสุ่มตรวจ" }),
      ),
    ).toBe(true);
  });

  it("gives each verdict button the CVE it is for", async () => {
    sampleMock.mockResolvedValue({ sample: sample() });
    open();
    expect(
      await screen.findByRole("button", { name: "ถูกต้อง ของ CVE-2024-0002" }),
    ).toBeInTheDocument();
  });

  it("warns with the rate and the limit as numbers once enough are reviewed and the rate is over", async () => {
    sampleMock.mockResolvedValue({
      sample: sample({
        reviewed: 30,
        falsePositives: 7,
        falsePositiveRate: 7 / 30,
      }),
    });
    open();
    const warning = await screen.findByTestId("vuln-sample-over-limit");
    expect(warning).toHaveTextContent("23.3%");
    expect(warning).toHaveTextContent("เกินเกณฑ์ 20%");
    expect(document.body.textContent).not.toMatch(DOCUMENT_CODE);
  });

  it.each([
    ["at the limit", 30, 6],
    ["below 30 reviewed", 29, 29],
    ["a high rate of a few", 4, 4],
  ])("does not warn %s", async (_name, reviewed, wrong) => {
    sampleMock.mockResolvedValue({
      sample: sample({
        reviewed,
        falsePositives: wrong,
        falsePositiveRate: wrong / reviewed,
      }),
    });
    open();
    await screen.findByTestId("vuln-sample-stats");
    expect(screen.queryByTestId("vuln-sample-over-limit")).toBeNull();
  });

  it("says when there is nothing to draw from", async () => {
    drawMock.mockRejectedValue(
      new ApiError(
        "VULNERABILITY_SAMPLE_EMPTY",
        "ยังไม่มีผล match ให้สุ่มตรวจ",
        409,
      ),
    );
    open();
    await userEvent.click(await screen.findByTestId("vuln-sample-draw"));
    expect(await screen.findByTestId("vuln-sample-error")).toHaveTextContent(
      "ยังไม่มีผล match ให้สุ่มตรวจ",
    );
  });

  it("does not offer a draw before any result exists", async () => {
    listMock.mockResolvedValue(list({ results: null, run: null }));
    open();
    expect(await screen.findByTestId("vuln-sample-draw")).toBeDisabled();
  });
});

describe("the sample page for anyone else", () => {
  it("shows a restricted state, never asks for the sampled results, and still tells whether the limit is passed", async () => {
    listMock.mockResolvedValue(
      list({
        canManage: false,
        falsePositive: {
          reviewed: 40,
          falsePositives: 10,
          falsePositiveRate: 0.25,
          overLimit: true,
        },
      }),
    );
    open();
    const restricted = await screen.findByTestId("vuln-sample-restricted");
    expect(restricted).toHaveTextContent("ผู้ดูแล Project เท่านั้น");
    expect(screen.getByTestId("vuln-sample-over-limit")).toHaveTextContent(
      "25%",
    );
    expect(sampleMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("vuln-sample-draw")).toBeNull();
    expect(screen.queryByTestId("vuln-sample-item-1")).toBeNull();
  });

  it("shows the restricted state, not the error, when the API answers 403", async () => {
    sampleMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "x", 403));
    open();
    expect(await screen.findByTestId("vuln-sample-restricted")).toBeVisible();
    expect(screen.queryByTestId("vuln-sample-error")).toBeNull();
  });

  it("says a Project that cannot be reached is not found", async () => {
    listMock.mockRejectedValue(new ApiError("PROJECT_NOT_FOUND", "x", 404));
    open();
    expect(
      await screen.findByText("ไม่พบข้อมูลที่ขอ หรือคุณเข้าถึงไม่ได้"),
    ).toBeVisible();
    expect(sampleMock).not.toHaveBeenCalled();
  });
});
