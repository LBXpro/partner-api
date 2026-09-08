import type { Command } from "../command.ts";
import {
  formatDate,
  formatMoney,
  formatPercent,
  truncate,
  type CommandResult,
} from "../output.ts";
import { requireArg } from "./shared.ts";

interface OfferEconomics {
  subscriptionPrice?: number | null;
  minInvestment?: number | null;
  maxInvestment?: number | null;
  tokenIssueFeePct?: number | null;
  adminFeePct?: number | null;
  adminFeeYears?: number | null;
  investorDeadline?: string | null;
  subscriptionDeadline?: string | null;
  forQualifiedOnly?: boolean | null;
  displayStatus?: string | null;
}

interface OpportunityListItem {
  slug: string;
  displayName: string | null;
  tagline: string | null;
  type: string | null;
  listingType: string | null;
  visibility: string | null;
  minInvestment: number | null;
  economics: OfferEconomics | null;
}

/** Only tokenized offers can be ordered through the API. */
const orderable = (item: OpportunityListItem): boolean =>
  item.listingType === "tokenized";

const list: Command = {
  path: ["opportunities", "list"],
  summary: "Active, publicly visible offers",
  usage: "lbx opportunities list",
  tabular: true,
  async run({ client }): Promise<CommandResult<OpportunityListItem>> {
    const data = await client.get<{ items?: OpportunityListItem[] }>(
      "/v1/partner/opportunities",
    );
    const items = data.items ?? [];
    return {
      data,
      table: {
        columns: [
          { header: "SLUG", value: (row) => row.slug },
          { header: "NAME", value: (row) => truncate(row.displayName, 40) },
          { header: "TYPE", value: (row) => row.type },
          { header: "LISTING", value: (row) => row.listingType },
          { header: "ORDERABLE", value: (row) => orderable(row) },
          { header: "STATUS", value: (row) => row.economics?.displayStatus },
          {
            header: "MIN",
            value: (row) => formatMoney(row.minInvestment ?? row.economics?.minInvestment),
            raw: (row) => row.minInvestment ?? row.economics?.minInvestment,
            align: "right",
          },
          {
            header: "UNIT PRICE",
            value: (row) => formatMoney(row.economics?.subscriptionPrice),
            raw: (row) => row.economics?.subscriptionPrice,
            align: "right",
          },
          {
            header: "DEADLINE",
            value: (row) => formatDate(row.economics?.investorDeadline),
          },
        ],
        rows: items,
        footer: `${items.length} offer(s), ${items.filter(orderable).length} orderable`,
      },
    };
  },
};

const get: Command = {
  path: ["opportunities", "get"],
  summary: "One offer in full",
  usage: "lbx opportunities get <slug>",
  async run({ client, args }): Promise<CommandResult> {
    const slug = requireArg(args, 0, "slug", get.usage);
    const data = await client.get<{ opportunity?: OpportunityListItem }>(
      `/v1/partner/opportunities/${encodeURIComponent(slug)}`,
    );
    const offer = (data.opportunity ?? data) as OpportunityListItem;
    const economics = offer.economics ?? {};
    return {
      data,
      lines: [
        `${offer.displayName ?? slug}  (${offer.slug ?? slug})`,
        offer.tagline ? `  ${offer.tagline}` : "",
        `listing        ${offer.listingType ?? "—"}${orderable(offer) ? " (orderable)" : " (not orderable via API)"}`,
        `visibility     ${offer.visibility ?? "—"}`,
        `status         ${economics.displayStatus ?? "—"}`,
        `unit price     ${formatMoney(economics.subscriptionPrice) ?? "—"}`,
        `min investment ${formatMoney(economics.minInvestment ?? offer.minInvestment) ?? "—"}`,
        `max investment ${formatMoney(economics.maxInvestment) ?? "—"}`,
        `issue fee      ${formatPercent(economics.tokenIssueFeePct) ?? "—"}`,
        `admin fee      ${formatPercent(economics.adminFeePct) ?? "—"}${
          economics.adminFeeYears ? ` for ${economics.adminFeeYears}y` : ""
        }`,
        `qualified only ${economics.forQualifiedOnly ? "yes" : "no"}`,
        `deadline       ${formatDate(economics.investorDeadline) ?? "—"}`,
      ].filter((line) => line !== ""),
    };
  },
};

export const opportunityCommands: Command[] = [list, get];
