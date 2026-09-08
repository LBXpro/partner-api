import type { Command } from "../command.ts";
import { formatMoney, type CommandResult } from "../output.ts";
import { requireDay } from "./companies.ts";

interface DailyPriceRow {
  slug: string;
  company: string | null;
  institutionalPrice: number | null;
  retailPrice: number | null;
}

interface DailyPricesResponse {
  /** The day served; null when nothing has been published yet. */
  date: string | null;
  items?: DailyPriceRow[];
}

/**
 * The bulk pull: every company priced on one day. `companies prices <slug>`
 * is the per-company series.
 */
const prices: Command = {
  path: ["prices"],
  summary: "Daily prices for every priced company on one day (default: latest)",
  usage: "lbx prices [--date <YYYY-MM-DD>]",
  tabular: true,
  options: [["--date <YYYY-MM-DD>", "Pricing day (UTC); default is the latest day with prices"]],
  async run({ client, flags }): Promise<CommandResult<DailyPriceRow>> {
    const date = requireDay(flags, "date");
    const data = await client.get<DailyPricesResponse>("/v1/partner/daily-prices", { date });
    const items = data.items ?? [];
    return {
      data,
      table: {
        title: data.date ? `daily prices — ${data.date}` : "daily prices",
        columns: [
          { header: "SLUG", value: (row) => row.slug },
          { header: "COMPANY", value: (row) => row.company },
          {
            header: "INSTITUTIONAL",
            value: (row) => formatMoney(row.institutionalPrice),
            raw: (row) => row.institutionalPrice,
            align: "right",
          },
          {
            header: "RETAIL",
            value: (row) => formatMoney(row.retailPrice),
            raw: (row) => row.retailPrice,
            align: "right",
          },
        ],
        rows: items,
        footer:
          data.date === null || data.date === undefined
            ? "no daily prices published yet"
            : items.length === 0
              ? `no prices on ${data.date}`
              : `${items.length} compan${items.length === 1 ? "y" : "ies"}`,
      },
    };
  },
};

export const priceCommands: Command[] = [prices];
