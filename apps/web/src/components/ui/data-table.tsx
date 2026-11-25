import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "../shell/icons";
import { Skeleton } from "../shell/Skeleton";
import { Button } from "./button";

export type SortDirection = "asc" | "desc";

export type DataTableSort = {
  /** Key of the sorted column; null when the order is not one a column offers. */
  key: string | null;
  direction: SortDirection;
  onSortChange: (key: string, direction: SortDirection) => void;
};

export type DataTableColumn<Row> = {
  key: string;
  header: ReactNode;
  /** CSS width such as "30%" or "160px"; unset columns share the rest. */
  width?: string;
  align?: "start" | "end";
  /** Identifiers, addresses and counts: JetBrains Mono at 13 px. */
  mono?: boolean;
  /** The first direction applies when the column becomes active. Setting it makes the header a button (needs `sort`). */
  sortDirections?: readonly SortDirection[];
  cell: (row: Row) => ReactNode;
};

// Presentational table: sans header on Surface (TYP-04), 44 px rows. Callers own sorting,
// filtering and selection; a sortable header only reports the order through `sort.onSortChange`.
export function DataTable<Row>({
  ariaLabel,
  columns,
  rows,
  rowKey,
  rowTestId,
  tableTestId,
  cellTestId,
  columnHeaderTestId,
  rowActions,
  empty,
  caption,
  captionVisible = false,
  skeleton,
  sort,
  className,
  dense = false,
  stickyRowActions = false,
  "data-testid": testId,
}: {
  "data-testid"?: string;
  ariaLabel: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowTestId?: (row: Row) => string;
  tableTestId?: string;
  cellTestId?: (column: DataTableColumn<Row>) => string;
  columnHeaderTestId?: (column: DataTableColumn<Row>) => string;
  rowActions?: (row: Row) => ReactNode;
  empty?: ReactNode;
  /** Names the table for assistive technology; visible only with `captionVisible`. */
  caption?: ReactNode;
  captionVisible?: boolean;
  /** Renders this many placeholder rows instead of `rows` while data loads. */
  skeleton?: number;
  sort?: DataTableSort;
  className?: string;
  /** Narrower cell padding for a table with many columns. */
  dense?: boolean;
  stickyRowActions?: boolean;
}) {
  const padding = dense ? "px-2" : "px-4";
  const columnCount = columns.length + (rowActions === undefined ? 0 : 1);
  return (
    <div
      data-testid={testId}
      tabIndex={0}
      role="region"
      aria-label={ariaLabel}
      className={cn(
        "overflow-x-auto rounded-md border border-foreground/10 bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
    >
      <table
        data-testid={tableTestId}
        aria-busy={skeleton === undefined ? undefined : true}
        className="w-full min-w-[560px] text-left text-sm"
      >
        {caption === undefined ? null : (
          <caption
            className={cn(
              captionVisible
                ? "px-4 py-3 text-left text-sm font-medium"
                : "sr-only",
            )}
          >
            {caption}
          </caption>
        )}
        <thead className="bg-surface text-xs font-medium text-foreground-secondary">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                data-testid={columnHeaderTestId?.(column)}
                scope="col"
                aria-sort={
                  sort?.key === column.key && column.sortDirections
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                style={
                  column.width === undefined
                    ? undefined
                    : { width: column.width }
                }
                className={cn(
                  "h-11 border-b border-foreground/10 font-medium whitespace-nowrap",
                  padding,
                  column.align === "end" && "text-end",
                )}
              >
                {sort === undefined || column.sortDirections === undefined ? (
                  column.header
                ) : (
                  <SortButton
                    column={column}
                    sort={sort}
                    directions={column.sortDirections}
                  />
                )}
              </th>
            ))}
            {rowActions === undefined ? null : (
              <th
                scope="col"
                className={cn(
                  "h-11 border-b border-foreground/10",
                  padding,
                  stickyRowActions && "sticky right-0 z-20 bg-surface",
                )}
              >
                <span className="sr-only">การดำเนินการ</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {skeleton === undefined
            ? null
            : Array.from({ length: skeleton }, (_, index) => (
                <tr
                  key={index}
                  data-testid="data-table-skeleton-row"
                  className="border-b border-foreground/10 last:border-0"
                >
                  {Array.from({ length: columnCount }, (_, cell) => (
                    <td key={cell} className={cn("h-11", padding)}>
                      <Skeleton className="h-4 w-full max-w-32" />
                    </td>
                  ))}
                </tr>
              ))}
          {skeleton === undefined &&
          rows.length === 0 &&
          empty !== undefined ? (
            <tr>
              <td
                colSpan={columnCount}
                className="h-11 px-4 text-center text-foreground-secondary"
              >
                {empty}
              </td>
            </tr>
          ) : null}
          {(skeleton === undefined ? rows : []).map((row) => (
            <tr
              key={rowKey(row)}
              data-testid={rowTestId?.(row)}
              className="border-b border-foreground/10 transition-colors duration-100 last:border-0 hover:surface-hover"
            >
              {columns.map((column) => (
                <td
                  data-testid={cellTestId?.(column)}
                  key={column.key}
                  className={cn(
                    "h-11 py-1 align-middle",
                    padding,
                    column.mono && "font-mono text-[13px]",
                    column.align === "end" && "text-end",
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
              {rowActions === undefined ? null : (
                <td
                  className={cn(
                    "h-11 text-end align-middle",
                    padding,
                    stickyRowActions &&
                      "sticky right-0 bg-surface border-l border-foreground/10",
                  )}
                >
                  {rowActions(row)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortButton<Row>({
  column,
  sort,
  directions,
}: {
  column: DataTableColumn<Row>;
  sort: DataTableSort;
  directions: readonly SortDirection[];
}) {
  const active = sort.key === column.key;
  const next =
    (active
      ? directions.find((direction) => direction !== sort.direction)
      : undefined) ??
    directions[0] ??
    "asc";
  const Icon = !active
    ? ChevronsUpDownIcon
    : sort.direction === "asc"
      ? ArrowUpIcon
      : ArrowDownIcon;
  return (
    <button
      type="button"
      onClick={() => {
        sort.onSortChange(column.key, next);
      }}
      className={cn(
        "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-1 font-medium whitespace-nowrap hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        active && "text-foreground",
        column.align === "end" && "flex-row-reverse",
      )}
    >
      {column.header}
      <Icon size={14} />
    </button>
  );
}

export function DataTablePagination({
  "data-testid": testId,
  ariaLabel,
  summary,
  summaryTestId,
  previousLabel,
  nextLabel,
  previousTestId,
  nextTestId,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  ariaLabel: string;
  "data-testid"?: string;
  summary: ReactNode;
  summaryTestId?: string;
  previousLabel: string;
  nextLabel: string;
  previousTestId?: string;
  nextTestId?: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav
      data-testid={testId}
      aria-label={ariaLabel}
      className="flex flex-wrap items-center justify-between gap-4"
    >
      <p
        data-testid={summaryTestId}
        className="text-xs text-foreground-secondary tabular-nums"
      >
        {summary}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid={previousTestId}
          disabled={!hasPrevious}
          onClick={onPrevious}
        >
          {previousLabel}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid={nextTestId}
          disabled={!hasNext}
          onClick={onNext}
        >
          {nextLabel}
        </Button>
      </div>
    </nav>
  );
}
