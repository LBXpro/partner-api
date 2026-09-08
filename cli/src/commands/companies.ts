import { getBoolean, getInteger, getList, getNumber, getString } from "../args.ts";
import type { Command } from "../command.ts";
import { UsageError } from "../errors.ts";
import {
  formatCompactMoney,
  formatDate,
  formatMoney,
  formatPercent,
  type CommandResult,
  type Table,
} from "../output.ts";
import { requireArg } from "./shared.ts";

interface CompanyListItem {
  slug: string;
  name: string | null;
  industry: string | null;
  cohort: string | null;
  inLBX25: boolean | null;
  launchbayPrice: number | null;
  impliedValuation: number | null;
  secondaryPremium: number | null;
  activityScore: number | null;
  lastRound: string | null;
  lastRoundDate: string | null;
}

interface CompanyListResponse {
  items: CompanyListItem[];
  total: number | null;
}

const list: Command = {
  path: ["companies", "list"],
  summary: "Browse the company catalog",
  usage: "lbx companies list [--search <q>] [--industry <name>]… [--limit <n>]",
  tabular: true,
  options: [
    ["--search <q>", "Free-text search over company names"],
    ["--industry <name>", "Industry name; repeat the flag for several"],
    ["--cohort <name>", "Filter by cohort"],
    ["--in-lbx25", "Only LBX25 constituents"],
    ["--no-in-lbx25", "Sends inLBX25=false; today's API does not filter on it yet"],
    ["--min-valuation / --max-valuation", "lastPrimaryValuation bounds, USD"],
    ["--min-premium / --max-premium", "Secondary premium bounds, %"],
    ["--min-activity / --max-activity", "Activity score bounds"],
    ["--date-from / --date-to", "lastRoundDate bounds (ISO 8601)"],
    ["--sort-by <field>", "Sort field (default lastRoundDate)"],
    ["--sort-order <asc|desc>", "Sort direction (default desc)"],
    ["--limit <n>", "Page size, max 200 (default 20)"],
    ["--offset <n>", "Rows to skip"],
  ],
  async run({ client, flags }): Promise<CommandResult<CompanyListItem>> {
    const limit = getInteger(flags, "limit");
    if (limit !== undefined && (limit < 1 || limit > 200)) {
      throw new UsageError("--limit must be between 1 and 200");
    }
    const sortOrder = getString(flags, "sortOrder");
    if (sortOrder !== undefined && !["asc", "desc"].includes(sortOrder)) {
      throw new UsageError('--sort-order must be "asc" or "desc"');
    }

    const data = await client.get<CompanyListResponse>(
      "/v1/partner/companies",
      {
        search: getString(flags, "search"),
        industry: getList(flags, "industry"),
        cohort: getString(flags, "cohort"),
        inLBX25: getBoolean(flags, "inLbx25"),
        minValuation: getNumber(flags, "minValuation"),
        maxValuation: getNumber(flags, "maxValuation"),
        minSecondaryPremium: getNumber(flags, "minPremium"),
        maxSecondaryPremium: getNumber(flags, "maxPremium"),
        minActivityScore: getNumber(flags, "minActivity"),
        maxActivityScore: getNumber(flags, "maxActivity"),
        dateFrom: getString(flags, "dateFrom"),
        dateTo: getString(flags, "dateTo"),
        sortBy: getString(flags, "sortBy"),
        sortOrder,
        limit,
        offset: getInteger(flags, "offset"),
      },
    );

    const items = data.items ?? [];
    return {
      data,
      table: {
        columns: [
          { header: "SLUG", value: (row) => row.slug },
          { header: "NAME", value: (row) => row.name },
          { header: "INDUSTRY", value: (row) => row.industry },
          { header: "LBX25", value: (row) => row.inLBX25 },
          {
            header: "PRICE",
            value: (row) => formatMoney(row.launchbayPrice),
            raw: (row) => row.launchbayPrice,
            align: "right",
          },
          {
            header: "VALUATION",
            value: (row) => formatCompactMoney(row.impliedValuation),
            raw: (row) => row.impliedValuation,
            align: "right",
          },
          {
            header: "PREMIUM",
            value: (row) => formatPercent(row.secondaryPremium),
            raw: (row) => row.secondaryPremium,
            align: "right",
          },
          { header: "LAST ROUND", value: (row) => formatDate(row.lastRoundDate) },
        ],
        rows: items,
        footer:
          data.total === null || data.total === undefined
            ? `${items.length} shown`
            : `${items.length} of ${data.total}`,
      },
    };
  },
};

const get: Command = {
  path: ["companies", "get"],
  summary: "Company detail with pricing and activity history",
  usage: "lbx companies get <slug>",
  async run({ client, args }): Promise<CommandResult> {
    const slug = requireArg(args, 0, "slug", get.usage);
    const data = await client.get<{ company?: Record<string, unknown> }>(
      `/v1/partner/companies/${encodeURIComponent(slug)}`,
    );
    const company = (data.company ?? data) as Record<string, unknown>;
    return {
      data,
      lines: [
        `${company.name ?? slug}  (${company.slug ?? slug})`,
        `industry     ${company.industry ?? "—"}`,
        `cohort       ${company.cohort ?? "—"}`,
        `in LBX25     ${company.inLBX25 ? "yes" : "no"}`,
        `LBX price    ${formatMoney(company.launchbayPrice) ?? "—"}`,
        `valuation    ${formatCompactMoney(company.impliedValuation) ?? "—"}`,
        `premium      ${formatPercent(company.secondaryPremium) ?? "—"}`,
        `last round   ${company.lastRound ?? "—"} ${formatDate(company.lastRoundDate) ?? ""}`.trimEnd(),
      ],
    };
  },
};

interface PricingPoint {
  date: string;
  price: number | null;
  valuation: number | null;
  premium: number | null;
}

/** The chart window's rounds — `companies funding` has the full list. */
interface ChartFundingPoint {
  date: string;
  round: string | null;
  size: number | null;
  valuation: number | null;
  pps: number | null;
}

const charts: Command = {
  path: ["companies", "charts"],
  summary: "24-month pricing series and the funding rounds in that window",
  usage: "lbx companies charts <slug>",
  options: [["--csv", "Exports the pricing series; `companies funding --csv` for rounds"]],
  tabular: true,
  async run({ client, args }): Promise<CommandResult<PricingPoint>> {
    const slug = requireArg(args, 0, "slug", charts.usage);
    const data = await client.get<{
      pricingHistory?: PricingPoint[];
      fundingRounds?: ChartFundingPoint[];
    }>(`/v1/partner/companies/${encodeURIComponent(slug)}/charts`);
    const rounds: Table<ChartFundingPoint> = {
      title: "funding rounds",
      columns: [
        { header: "DATE", value: (row) => formatDate(row.date) },
        { header: "ROUND", value: (row) => row.round },
        { header: "SIZE", value: (row) => formatCompactMoney(row.size), align: "right" },
        { header: "VALUATION", value: (row) => formatCompactMoney(row.valuation), align: "right" },
        { header: "PPS", value: (row) => formatMoney(row.pps), align: "right" },
      ],
      rows: data.fundingRounds ?? [],
    };
    return {
      data,
      tables: [rounds],
      table: {
        title: "pricing",
        columns: [
          { header: "DATE", value: (row) => formatDate(row.date) },
          { header: "PRICE", value: (row) => formatMoney(row.price), raw: (row) => row.price, align: "right" },
          {
            header: "VALUATION",
            value: (row) => formatCompactMoney(row.valuation),
            raw: (row) => row.valuation,
            align: "right",
          },
          {
            header: "PREMIUM",
            value: (row) => formatPercent(row.premium),
            raw: (row) => row.premium,
            align: "right",
          },
        ],
        rows: data.pricingHistory ?? [],
      },
    };
  },
};

interface FundingRound {
  round: string | null;
  date: string | null;
  roundSize: number | null;
  valuation: number | null;
  pricePerShare: number | null;
}

const funding: Command = {
  path: ["companies", "funding"],
  summary: "All funding rounds for a company",
  usage: "lbx companies funding <slug>",
  tabular: true,
  async run({ client, args }): Promise<CommandResult<FundingRound>> {
    const slug = requireArg(args, 0, "slug", funding.usage);
    const data = await client.get<{ rounds?: FundingRound[] }>(
      `/v1/partner/companies/${encodeURIComponent(slug)}/funding`,
    );
    return {
      data,
      table: {
        columns: [
          { header: "ROUND", value: (row) => row.round },
          { header: "DATE", value: (row) => formatDate(row.date) },
          {
            header: "SIZE",
            value: (row) => formatCompactMoney(row.roundSize),
            raw: (row) => row.roundSize,
            align: "right",
          },
          {
            header: "VALUATION",
            value: (row) => formatCompactMoney(row.valuation),
            raw: (row) => row.valuation,
            align: "right",
          },
          {
            header: "PRICE/SHARE",
            value: (row) => formatMoney(row.pricePerShare),
            raw: (row) => row.pricePerShare,
            align: "right",
          },
        ],
        rows: data.rounds ?? [],
      },
    };
  },
};

export const companyCommands: Command[] = [list, get, charts, funding];
