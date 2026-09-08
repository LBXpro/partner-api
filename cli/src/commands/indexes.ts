import { getInteger } from "../args.ts";
import type { Command } from "../command.ts";
import { formatDate, formatNumber, formatPercent, type CommandResult } from "../output.ts";
import { requireArg } from "./shared.ts";

interface IndexItem {
  id: string;
  indexName: string | null;
  indexType: string | null;
  currentValue: number | null;
  initialValue: number | null;
  oneMonthPerformance: number | null;
  threeMonthPerformance: number | null;
  oneYearPerformance: number | null;
  totalHoldings: number | null;
}

const list: Command = {
  path: ["indexes", "list"],
  summary: "LBX indexes with current level and performance",
  usage: "lbx indexes list",
  tabular: true,
  async run({ client }): Promise<CommandResult<IndexItem>> {
    const data = await client.get<{ items?: IndexItem[] }>("/v1/partner/indexes");
    return {
      data,
      table: {
        columns: [
          { header: "ID", value: (row) => row.id },
          { header: "NAME", value: (row) => row.indexName },
          { header: "TYPE", value: (row) => row.indexType },
          {
            header: "LEVEL",
            value: (row) => (row.currentValue === null ? null : formatNumber(row.currentValue)),
            raw: (row) => row.currentValue,
            align: "right",
          },
          {
            header: "1M",
            value: (row) => formatPercent(row.oneMonthPerformance),
            raw: (row) => row.oneMonthPerformance,
            align: "right",
          },
          {
            header: "3M",
            value: (row) => formatPercent(row.threeMonthPerformance),
            raw: (row) => row.threeMonthPerformance,
            align: "right",
          },
          {
            header: "1Y",
            value: (row) => formatPercent(row.oneYearPerformance),
            raw: (row) => row.oneYearPerformance,
            align: "right",
          },
          { header: "HOLDINGS", value: (row) => row.totalHoldings, align: "right" },
        ],
        rows: data.items ?? [],
      },
    };
  },
};

interface HistoryPoint {
  date: string;
  value: number | null;
}

const history: Command = {
  path: ["indexes", "history"],
  summary: "Index level over time",
  usage: "lbx indexes history <id|lbx25> [--months <n>]",
  tabular: true,
  options: [["--months <n>", "How far back to go (server default applies if omitted)"]],
  async run({ client, args, flags }): Promise<CommandResult<HistoryPoint>> {
    const id = requireArg(args, 0, "id", history.usage);
    const data = await client.get<{ history?: HistoryPoint[] }>(
      `/v1/partner/indexes/${encodeURIComponent(id)}/history`,
      { months: getInteger(flags, "months") },
    );
    const points = data.history ?? [];
    return {
      data,
      table: {
        columns: [
          { header: "DATE", value: (row) => formatDate(row.date) },
          {
            header: "LEVEL",
            value: (row) => (row.value === null ? null : formatNumber(row.value)),
            raw: (row) => row.value,
            align: "right",
          },
        ],
        rows: points,
        footer: `${points.length} point(s)`,
      },
    };
  },
};

export const indexCommands: Command[] = [list, history];
