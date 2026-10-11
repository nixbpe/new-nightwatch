import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

export type DataTableColumn<Row> = {
  key: string;
  header: ReactNode;
  /** CSS width such as "30%" or "160px"; unset columns share the rest. */
  width?: string;
  align?: "start" | "end";
  /** Identifiers, addresses and counts: JetBrains Mono at 13 px. */
  mono?: boolean;
  cell: (row: Row) => ReactNode;
};

// Presentational table: sans header on Surface (TYP-04), 44 px rows, hairline
// dividers and a hover tint. Callers own sorting, filtering and selection.
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
  className,
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
  /** Trailing cell reserved for row actions (role changes, revoke). */
  rowActions?: (row: Row) => ReactNode;
  /** Shown as one full-width row when `rows` is empty. */
  empty?: ReactNode;
  className?: string;
}) {
  const columnCount = columns.length + (rowActions === undefined ? 0 : 1);
  return (
    <div
      data-testid={testId}
      tabIndex={0}
      role="region"
      aria-label={ariaLabel}
      className={cn(
        "max-h-[70vh] overflow-auto rounded-md border border-foreground/10 bg-surface focus:outline-2 focus:outline-offset-2 focus:outline-primary",
        className,
      )}
    >
      <table
        data-testid={tableTestId}
        className="w-full min-w-[560px] text-left text-sm"
      >
        <thead className="sticky top-0 z-10 bg-surface text-xs font-medium text-foreground-secondary">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                data-testid={columnHeaderTestId?.(column)}
                scope="col"
                style={
                  column.width === undefined
                    ? undefined
                    : { width: column.width }
                }
                className={cn(
                  "h-11 border-b border-foreground/10 px-4 font-medium whitespace-nowrap",
                  column.align === "end" && "text-end",
                )}
              >
                {column.header}
              </th>
            ))}
            {rowActions === undefined ? null : (
              <th
                scope="col"
                className="h-11 border-b border-foreground/10 px-4"
              />
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty !== undefined ? (
            <tr>
              <td
                colSpan={columnCount}
                className="h-11 px-4 text-center text-foreground-secondary"
              >
                {empty}
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
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
                    "h-11 px-4 align-middle",
                    column.mono && "font-mono text-[13px]",
                    column.align === "end" && "text-end",
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
              {rowActions === undefined ? null : (
                <td className="h-11 px-4 text-end align-middle">
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

// "Showing a–b of n" plus quiet previous/next; the page supplies the words.
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
