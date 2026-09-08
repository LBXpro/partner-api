import { UsageError } from "./errors.ts";

export type OutputFormat = "table" | "json" | "csv";

export interface Column<Row> {
  header: string;
  /** Human-facing cell — formatted money, percentages, short dates. */
  value: (row: Row) => unknown;
  /**
   * Machine-facing cell used by --csv. Money columns format to "$6.99B" for
   * reading, which a spreadsheet cannot add up; give the raw number here.
   */
  raw?: (row: Row) => unknown;
  align?: "left" | "right";
}

export interface Table<Row = any> {
  /** Printed above the table when a result shows more than one. */
  title?: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  /** Printed under the table in table mode (e.g. "5 of 967"). */
  footer?: string;
}

/** What a command hands back: raw data for --json, a table for humans. */
export interface CommandResult<Row = any> {
  data: unknown;
  table?: Table<Row>;
  /** Further tables printed after `table` in table mode; --csv exports `table` only. */
  tables?: Table<any>[];
  /** Free-form lines shown instead of a table when there is nothing tabular. */
  lines?: string[];
  /** Raw bytes for stdout — a downloaded file — bypassing every renderer. */
  bytes?: Uint8Array;
}

export const EMPTY_CELL = "—";

export function render(
  result: CommandResult<any>,
  format: OutputFormat,
): string {
  if (format === "json") return JSON.stringify(result.data, null, 2);
  if (format === "csv") {
    // cli.ts refuses --csv before the request for commands not marked
    // tabular; this catches a command that is marked but returned lines.
    if (!result.table) {
      throw new UsageError("This command has no tabular output; use --json.");
    }
    return renderCsv(result.table);
  }
  if (result.table) {
    return [result.table, ...(result.tables ?? [])]
      .map((table) => renderTable(table))
      .join("\n\n");
  }
  if (result.lines) return result.lines.join("\n");
  return JSON.stringify(result.data, null, 2);
}

export function renderTable<Row>(table: Table<Row>): string {
  const headers = table.columns.map((column) => column.header);
  const body = table.rows.map((row) =>
    table.columns.map((column) => formatCell(column.value(row))),
  );

  const widths = headers.map((header, index) =>
    Math.max(
      displayWidth(header),
      ...body.map((cells) => displayWidth(cells[index] ?? "")),
    ),
  );

  const line = (cells: string[]): string =>
    cells
      .map((cell, index) => {
        const width = widths[index] ?? 0;
        const align = table.columns[index]?.align ?? "left";
        return align === "right" ? padStart(cell, width) : padEnd(cell, width);
      })
      .join("  ")
      .trimEnd();

  const out = [line(headers), line(widths.map((width) => "─".repeat(width)))];
  if (table.title) out.unshift(table.title);
  if (body.length === 0) {
    out.push("(no rows)");
  } else {
    out.push(...body.map(line));
  }
  if (table.footer) out.push("", table.footer);
  return out.join("\n");
}

export function renderCsv<Row>(table: Table<Row>): string {
  const escape = (value: string): string =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const head = table.columns.map((column) => escape(column.header)).join(",");
  const body = table.rows.map((row) =>
    table.columns
      .map((column) => escape(formatCell((column.raw ?? column.value)(row), { plain: true })))
      .join(","),
  );
  return [head, ...body].join("\n");
}

/**
 * `null` means "LBX has no value" throughout this API, so it renders as an
 * em dash rather than an empty cell that reads like zero. CSV wants the truly
 * empty string instead, so callers can ask for plain.
 */
export function formatCell(
  value: unknown,
  options: { plain?: boolean } = {},
): string {
  if (value === null || value === undefined) return options.plain ? "" : EMPTY_CELL;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  // Thousands separators are for reading; CSV must stay machine-parsable.
  if (typeof value === "number") {
    return options.plain ? String(value) : formatNumber(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatCell(item, options)).join(", ");
  }
  return JSON.stringify(value);
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Money in tables: `$1,234.56`. */
export function formatMoney(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const sign = value < 0 ? "-" : "";
  return `${sign}$${formatNumber(Math.abs(value))}`;
}

/** Valuations are huge; tables get `$1.43T`, JSON keeps the full number. */
export function formatCompactMoney(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [scale, suffix] of units) {
    if (abs >= scale) {
      return `${sign}$${(abs / scale).toFixed(2)}${suffix}`;
    }
  }
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatPercent(value: unknown, digits = 2): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value.toFixed(digits)}%`;
}

/** ISO timestamps are noisy in a table; keep the date. */
export function formatDate(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

export function formatDateTime(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().replace(".000Z", "Z");
}

export function truncate(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function displayWidth(value: string): number {
  return [...value].length;
}

function padEnd(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - displayWidth(value)));
}

function padStart(value: string, width: number): string {
  return " ".repeat(Math.max(0, width - displayWidth(value))) + value;
}
