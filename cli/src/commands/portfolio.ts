import { getBoolean } from "../args.ts";
import type { Command } from "../command.ts";
import {
  formatCompactMoney,
  formatDate,
  formatMoney,
  formatPercent,
  truncate,
  type Column,
  type CommandResult,
} from "../output.ts";
import { requireArg } from "./shared.ts";

/** One settled order lot (`PartnerPosition`). */
interface Position {
  id: string;
  orderId: string | null;
  opportunitySlug: string | null;
  opportunityName: string | null;
  numberOfUnits: number | null;
  initialAmount: number | null;
  positionValue: number | null;
  pnlVsSubscriptionPct: number | null;
  custodyAssetId: string | null;
  createdAt: string | null;
}

/** Lots grouped per offer (`PartnerHolding`) — the view most people want. */
interface Holding {
  opportunitySlug: string | null;
  opportunityName: string | null;
  domainName: string | null;
  numberOfUnits: number | null;
  investedTotal: number | null;
  positionValue: number | null;
  pnlVsSubscriptionPct: number | null;
  custodyAssetId: string | null;
  lots?: Position[] | null;
}

interface Summary {
  investedTotal?: number | null;
  valueTotal?: number | null;
  gain?: number | null;
  gainPct?: number | null;
  activePositions?: number | null;
}

const holdingColumns: readonly Column<Holding>[] = [
  { header: "OFFER", value: (row) => row.opportunitySlug },
  { header: "NAME", value: (row) => truncate(row.opportunityName, 32) },
  { header: "UNITS", value: (row) => row.numberOfUnits, align: "right" },
  {
    header: "INVESTED",
    value: (row) => formatMoney(row.investedTotal),
    raw: (row) => row.investedTotal,
    align: "right",
  },
  {
    header: "VALUE",
    value: (row) => formatMoney(row.positionValue),
    raw: (row) => row.positionValue,
    align: "right",
  },
  {
    header: "P&L",
    value: (row) => formatPercent(row.pnlVsSubscriptionPct),
    raw: (row) => row.pnlVsSubscriptionPct,
    align: "right",
  },
  { header: "LOTS", value: (row) => row.lots?.length ?? 0, align: "right" },
  { header: "CUSTODY ASSET", value: (row) => row.custodyAssetId },
];

const positionColumns: readonly Column<Position>[] = [
  { header: "POSITION", value: (row) => row.id },
  { header: "OFFER", value: (row) => row.opportunitySlug },
  { header: "UNITS", value: (row) => row.numberOfUnits, align: "right" },
  {
    header: "INVESTED",
    value: (row) => formatMoney(row.initialAmount),
    raw: (row) => row.initialAmount,
    align: "right",
  },
  {
    header: "VALUE",
    value: (row) => formatMoney(row.positionValue),
    raw: (row) => row.positionValue,
    align: "right",
  },
  {
    header: "P&L",
    value: (row) => formatPercent(row.pnlVsSubscriptionPct),
    raw: (row) => row.pnlVsSubscriptionPct,
    align: "right",
  },
  { header: "OPENED", value: (row) => formatDate(row.createdAt) },
  { header: "ORDER", value: (row) => row.orderId },
];

const show: Command = {
  path: ["portfolio", "show"],
  summary: "Holdings per offer, the lots behind them, and totals",
  usage: "lbx portfolio show [--lots]",
  options: [
    ["--lots", "Tabulate the individual lots (positions) instead of holdings; what --csv exports"],
  ],
  tabular: true,
  async run({ client, flags }): Promise<CommandResult> {
    const data = await client.get<{
      positions?: Position[];
      holdings?: Holding[];
      summary?: Summary;
    }>("/v1/partner/portfolio");
    const summary = data.summary ?? {};
    const positions = data.positions ?? [];
    const holdings = data.holdings ?? [];
    const footer = [
      `invested ${formatMoney(summary.investedTotal) ?? "—"}`,
      `value ${formatMoney(summary.valueTotal) ?? "—"}`,
      `gain ${formatMoney(summary.gain) ?? "—"}`,
      `(${formatPercent(summary.gainPct) ?? "—"})`,
      `across ${summary.activePositions ?? 0} position(s)`,
    ].join("  ");

    if (getBoolean(flags, "lots") === true) {
      return { data, table: { columns: positionColumns, rows: positions, footer } };
    }
    return {
      data,
      table: { title: "holdings", columns: holdingColumns, rows: holdings },
      tables: [{ title: "lots", columns: positionColumns, rows: positions, footer }],
    };
  },
};

interface PortfolioHistoryPoint {
  date: string;
  portfolioValue: number | null;
}

const history: Command = {
  path: ["portfolio", "history"],
  summary: "Portfolio value over time",
  usage: "lbx portfolio history",
  tabular: true,
  async run({ client }): Promise<CommandResult<PortfolioHistoryPoint>> {
    const data = await client.get<{ points?: PortfolioHistoryPoint[] }>(
      "/v1/partner/portfolio/history",
    );
    const points = data.points ?? [];
    return {
      data,
      table: {
        columns: [
          { header: "DATE", value: (row) => formatDate(row.date) },
          {
            header: "VALUE",
            value: (row) => formatMoney(row.portfolioValue),
            raw: (row) => row.portfolioValue,
            align: "right",
          },
        ],
        rows: points,
        footer: `${points.length} point(s)`,
      },
    };
  },
};

interface PositionHistoryPoint {
  date: string;
  positionValue: number | null;
  pnlVsSubscriptionPct: number | null;
  launchbayPricePerShare: number | null;
  impliedValuation: number | null;
}

const positionHistory: Command = {
  path: ["positions", "history"],
  summary: "One lot's value over time",
  usage: "lbx positions history <position-id>",
  tabular: true,
  async run({ client, args }): Promise<CommandResult<PositionHistoryPoint>> {
    const id = requireArg(args, 0, "position-id", positionHistory.usage);
    const data = await client.get<{ points?: PositionHistoryPoint[] }>(
      `/v1/partner/positions/${encodeURIComponent(id)}/history`,
    );
    const points = data.points ?? [];
    return {
      data,
      table: {
        columns: [
          { header: "DATE", value: (row) => formatDate(row.date) },
          {
            header: "VALUE",
            value: (row) => formatMoney(row.positionValue),
            raw: (row) => row.positionValue,
            align: "right",
          },
          {
            header: "P&L",
            value: (row) => formatPercent(row.pnlVsSubscriptionPct),
            raw: (row) => row.pnlVsSubscriptionPct,
            align: "right",
          },
          {
            header: "LBX PRICE",
            value: (row) => formatMoney(row.launchbayPricePerShare),
            raw: (row) => row.launchbayPricePerShare,
            align: "right",
          },
          {
            header: "VALUATION",
            value: (row) => formatCompactMoney(row.impliedValuation),
            raw: (row) => row.impliedValuation,
            align: "right",
          },
        ],
        rows: points,
        footer: `${points.length} point(s)`,
      },
    };
  },
};

export const portfolioCommands: Command[] = [show, history, positionHistory];
