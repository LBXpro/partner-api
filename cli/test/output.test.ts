import { describe, expect, test } from "bun:test";
import {
  EMPTY_CELL,
  formatCell,
  formatCompactMoney,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  render,
  renderCsv,
  renderTable,
  truncate,
  type Table,
} from "../src/output.ts";

interface Row {
  slug: string;
  price: number | null;
}

const table: Table<Row> = {
  columns: [
    { header: "SLUG", value: (row) => row.slug },
    { header: "PRICE", value: (row) => formatMoney(row.price), raw: (row) => row.price, align: "right" },
  ],
  rows: [
    { slug: "anthropic", price: 871.21 },
    { slug: "x", price: null },
  ],
};

describe("renderTable", () => {
  test("aligns columns and underlines the header", () => {
    expect(renderTable(table)).toBe(
      [
        "SLUG         PRICE",
        "─────────  ───────",
        "anthropic  $871.21",
        "x                —",
      ].join("\n"),
    );
  });

  test("says so when there are no rows", () => {
    expect(renderTable({ ...table, rows: [] })).toContain("(no rows)");
  });

  test("appends the footer after a blank line", () => {
    const rendered = renderTable({ ...table, footer: "2 of 967" });
    expect(rendered.endsWith("\n\n2 of 967")).toBe(true);
  });

  test("prints the title above the header when there is one", () => {
    expect(renderTable({ ...table, title: "prices" }).split("\n").slice(0, 2)).toEqual([
      "prices",
      "SLUG         PRICE",
    ]);
  });

  test("widens columns to fit the widest cell", () => {
    const wide = renderTable({
      columns: [{ header: "A", value: (row: { a: string }) => row.a }],
      rows: [{ a: "a-very-long-value" }],
    });
    expect(wide.split("\n")[1]).toBe("─".repeat("a-very-long-value".length));
  });
});

describe("renderCsv", () => {
  test("uses the raw accessor so numbers stay numeric", () => {
    expect(renderCsv(table)).toBe(["SLUG,PRICE", "anthropic,871.21", "x,"].join("\n"));
  });

  test("quotes commas, quotes and newlines", () => {
    const csv = renderCsv({
      columns: [{ header: "NAME", value: (row: { name: string }) => row.name }],
      rows: [{ name: 'A, "B"' }, { name: "line\nbreak" }],
    });
    expect(csv).toBe(['NAME', '"A, ""B"""', '"line\nbreak"'].join("\n"));
  });

  test("emits a header row even with no data", () => {
    expect(renderCsv({ ...table, rows: [] })).toBe("SLUG,PRICE");
  });
});

describe("render", () => {
  test("--json prints the untouched payload", () => {
    const result = { data: { total: 1, items: [{ slug: "a" }] }, table };
    expect(render(result, "json")).toBe(JSON.stringify(result.data, null, 2));
  });

  test("table mode prefers the table, then lines, then JSON", () => {
    expect(render({ data: {}, table }, "table")).toContain("anthropic");
    expect(render({ data: {}, lines: ["one", "two"] }, "table")).toBe("one\ntwo");
    expect(render({ data: { a: 1 } }, "table")).toBe('{\n  "a": 1\n}');
  });

  test("extra tables follow the main one, separated by a blank line", () => {
    const rendered = render(
      { data: {}, table: { ...table, title: "a" }, tables: [{ ...table, title: "b", rows: [] }] },
      "table",
    );
    expect(rendered).toContain("a\nSLUG");
    expect(rendered).toContain("\n\nb\nSLUG");
    expect(rendered).toContain("(no rows)");
  });

  test("--csv exports only the main table", () => {
    const csv = render({ data: {}, table, tables: [{ ...table, title: "b" }] }, "csv");
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).not.toContain("b");
  });

  test("--csv on a command with no table explains itself", () => {
    expect(() => render({ data: {}, lines: ["x"] }, "csv")).toThrow(
      /no tabular output/,
    );
  });
});

describe("formatCell", () => {
  test("null and undefined read as unknown, never as zero", () => {
    expect(formatCell(null)).toBe(EMPTY_CELL);
    expect(formatCell(undefined)).toBe(EMPTY_CELL);
  });

  test("plain mode leaves them empty for CSV", () => {
    expect(formatCell(null, { plain: true })).toBe("");
  });

  test("plain mode drops thousands separators so CSV stays numeric", () => {
    expect(formatCell(1_427_340_197_959)).toBe("1,427,340,197,959");
    expect(formatCell(1_427_340_197_959, { plain: true })).toBe("1427340197959");
  });

  test("booleans render as yes/no", () => {
    expect(formatCell(true)).toBe("yes");
    expect(formatCell(false)).toBe("no");
  });

  test("arrays join, objects fall back to JSON", () => {
    expect(formatCell(["a", "b"])).toBe("a, b");
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
  });
});

describe("number and date formatting", () => {
  test("formatNumber groups thousands and fixes decimals", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(3850.259401)).toBe("3,850.26");
  });

  test("formatMoney prefixes the sign correctly", () => {
    expect(formatMoney(871.21)).toBe("$871.21");
    expect(formatMoney(-40)).toBe("-$40");
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney("871")).toBeNull();
  });

  test("formatCompactMoney scales to T/B/M/K", () => {
    expect(formatCompactMoney(1_427_340_197_959)).toBe("$1.43T");
    expect(formatCompactMoney(935_926_361_098)).toBe("$935.93B");
    expect(formatCompactMoney(124_000_000)).toBe("$124.00M");
    expect(formatCompactMoney(1500)).toBe("$1.50K");
    expect(formatCompactMoney(12.5)).toBe("$12.50");
    expect(formatCompactMoney(null)).toBeNull();
  });

  test("formatPercent fixes two decimals by default", () => {
    expect(formatPercent(47.9123)).toBe("47.91%");
    expect(formatPercent(0.7, 1)).toBe("0.7%");
    expect(formatPercent(null)).toBeNull();
  });

  test("formatDate keeps the day, formatDateTime keeps the time", () => {
    expect(formatDate("2026-05-27T00:00:00.000Z")).toBe("2026-05-27");
    expect(formatDateTime("2026-05-27T10:30:00.000Z")).toBe("2026-05-27T10:30:00Z");
    expect(formatDate(null)).toBeNull();
  });

  test("an unparseable date is passed through rather than dropped", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  test("truncate adds an ellipsis only when needed", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect(truncate(42, 5)).toBeNull();
  });
});
