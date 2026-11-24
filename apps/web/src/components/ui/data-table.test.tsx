import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataTable, type DataTableColumn } from "./data-table";

type Row = { id: string; name: string };

const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", cell: (row) => row.name },
];
const rows: Row[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
];

function setup(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  render(
    <DataTable
      data-testid="table"
      ariaLabel="Things"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      {...props}
    />,
  );
}

describe("DataTable", () => {
  it("exposes a named, focusable region so keyboard users can scroll sideways", () => {
    setup();
    const region = screen.getByRole("region", { name: "Things" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByRole("table")).toBeInTheDocument();
  });

  it("names the table from the caption", () => {
    setup({ caption: "Monitor list" });
    expect(screen.getByRole("table", { name: "Monitor list" })).toBeVisible();
  });

  it("replaces rows with busy placeholder rows while skeleton is set", () => {
    setup({ skeleton: 3 });
    expect(screen.getAllByTestId("data-table-skeleton-row")).toHaveLength(3);
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("renders data rows and no busy state without skeleton", () => {
    setup();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("data-table-skeleton-row")).toBeNull();
    expect(screen.getByRole("table")).not.toHaveAttribute("aria-busy");
  });

  describe("sort", () => {
    const sortable: DataTableColumn<Row>[] = [
      {
        key: "name",
        header: "Name",
        sortDirections: ["asc", "desc"],
        cell: (row) => row.name,
      },
      {
        key: "size",
        header: "Size",
        sortDirections: ["desc"],
        cell: () => "1",
      },
      { key: "plain", header: "Plain", cell: () => "x" },
    ];

    it("marks only the sorted column with aria-sort and makes sortable headers buttons", () => {
      setup({
        columns: sortable,
        sort: { key: "name", direction: "asc", onSortChange: vi.fn() },
      });
      expect(
        screen.getByRole("columnheader", { name: "Name" }),
      ).toHaveAttribute("aria-sort", "ascending");
      expect(
        screen.getByRole("columnheader", { name: "Size" }),
      ).not.toHaveAttribute("aria-sort");
      expect(screen.getAllByRole("button")).toHaveLength(2);
      expect(
        within(screen.getByRole("columnheader", { name: "Plain" })).queryByRole(
          "button",
        ),
      ).toBeNull();
    });

    it("reports the first direction for an inactive column and flips an active one", async () => {
      const user = userEvent.setup();
      const onSortChange = vi.fn();
      setup({
        columns: sortable,
        sort: { key: "name", direction: "asc", onSortChange },
      });
      await user.click(screen.getByRole("button", { name: "Size" }));
      expect(onSortChange).toHaveBeenLastCalledWith("size", "desc");
      await user.click(screen.getByRole("button", { name: "Name" }));
      expect(onSortChange).toHaveBeenLastCalledWith("name", "desc");
    });

    it("keeps the only direction of an active single-direction column", async () => {
      const user = userEvent.setup();
      const onSortChange = vi.fn();
      setup({
        columns: sortable,
        sort: { key: "size", direction: "desc", onSortChange },
      });
      expect(
        screen.getByRole("columnheader", { name: "Size" }),
      ).toHaveAttribute("aria-sort", "descending");
      await user.click(screen.getByRole("button", { name: "Size" }));
      expect(onSortChange).toHaveBeenLastCalledWith("size", "desc");
    });

    it("renders plain headers without the table sort prop", () => {
      setup({ columns: sortable });
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});
