import type { Command } from "../command.ts";
import {
  formatCompactMoney,
  formatDateTime,
  formatMoney,
  formatPercent,
  type CommandResult,
} from "../output.ts";

interface Deal {
  /** A signed 64-bit integer as a string — never parse it as a JS number. */
  id: string;
  companyName: string;
  created: string;
  dealType: "ASK" | "BID";
  pps: number | null;
  structure: string;
  shareClass: string;
  managementFee: number | null;
  carry: number | null;
  verification: boolean;
  maxNumberOfShares: number | null;
  maxSize: number;
  minNumberOfShares: number | null;
  minSize: number | null;
  directToClient: boolean;
  domain: string | null;
  valuation: number | null;
  currency: string;
}

interface DealFlowResponse {
  /** When the feed was built; null only before the first build. */
  asOf: string | null;
  items?: Deal[];
}

/**
 * The whole deal-flow feed in one call — a few hundred orders, rebuilt once a
 * day. Needs a key that holds the deal-flow permission set.
 */
const dealFlow: Command = {
  path: ["deal-flow"],
  summary: "Your deal-flow feed: secondary-market orders of the last 28 days",
  usage: "lbx deal-flow",
  tabular: true,
  async run({ client }): Promise<CommandResult<Deal>> {
    const data = await client.get<DealFlowResponse>("/v1/partner/deal-flow");
    const items = data.items ?? [];
    return {
      data,
      table: {
        title: data.asOf ? `deal flow — as of ${formatDateTime(data.asOf)}` : "deal flow",
        columns: [
          { header: "ID", value: (row) => row.id },
          { header: "COMPANY", value: (row) => row.companyName },
          { header: "TYPE", value: (row) => row.dealType },
          {
            header: "PPS",
            value: (row) => formatMoney(row.pps),
            raw: (row) => row.pps,
            align: "right",
          },
          {
            header: "SIZE",
            value: (row) => formatCompactMoney(row.maxSize),
            raw: (row) => row.maxSize,
            align: "right",
          },
          {
            header: "VALUATION",
            value: (row) => formatCompactMoney(row.valuation),
            raw: (row) => row.valuation,
            align: "right",
          },
          { header: "STRUCTURE", value: (row) => row.structure },
          { header: "CLASS", value: (row) => row.shareClass },
          {
            header: "FEE",
            value: (row) => formatPercent(row.managementFee),
            raw: (row) => row.managementFee,
            align: "right",
          },
          {
            header: "CARRY",
            value: (row) => formatPercent(row.carry),
            raw: (row) => row.carry,
            align: "right",
          },
          { header: "CREATED", value: (row) => row.created },
        ],
        rows: items,
        footer: `${items.length} order${items.length === 1 ? "" : "s"}`,
      },
    };
  },
};

export const dealFlowCommands: Command[] = [dealFlow];
