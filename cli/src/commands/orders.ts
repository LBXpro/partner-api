import { stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getNumber, getString } from "../args.ts";
import type { Command } from "../command.ts";
import { ApiError, CliError, EXIT, UsageError } from "../errors.ts";
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  type CommandResult,
} from "../output.ts";
import { requireArg } from "./shared.ts";

/** Custody-side file issued against the order (signed prospectus, receipt). */
interface SettlementDocument {
  uid: string;
  fileName: string | null;
  kind: string | null;
  size: number | null;
}

interface Order {
  id: string;
  status: string | null;
  opportunitySlug: string | null;
  opportunityName: string | null;
  initialAmount: number | null;
  numberOfUnits: number | null;
  subscriptionPrice: number | null;
  tokenIssueFeeAmount: number | null;
  adminFeeAmount: number | null;
  totalAmount: number | null;
  signingUrl: string | null;
  failureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  custodyOrderId?: string | null;
  opportunitySnapshot?: { custodyAssetId?: string | null } | null;
  settlementDocuments?: SettlementDocument[] | null;
  statusHistory?: { status: string; at: string; by?: string | null; note?: string | null }[] | null;
}

const orderLines = (order: Order): string[] => {
  const lines = [
    `order ${order.id}`,
    `status         ${order.status ?? "—"}`,
    `offer          ${order.opportunityName ?? order.opportunitySlug ?? "—"}`,
    `amount         ${formatMoney(order.initialAmount) ?? "—"}`,
    `units          ${order.numberOfUnits === null || order.numberOfUnits === undefined ? "—" : formatNumber(order.numberOfUnits)}`,
    `unit price     ${formatMoney(order.subscriptionPrice) ?? "—"}`,
    `issue fee      ${formatMoney(order.tokenIssueFeeAmount) ?? "—"}`,
    `admin fee      ${formatMoney(order.adminFeeAmount) ?? "—"}`,
    `total          ${formatMoney(order.totalAmount) ?? "—"}`,
    `created        ${formatDateTime(order.createdAt) ?? "—"}`,
  ];
  if (order.custodyOrderId) lines.push(`custody order  ${order.custodyOrderId}`);
  const custodyAssetId = order.opportunitySnapshot?.custodyAssetId;
  if (custodyAssetId) lines.push(`custody asset  ${custodyAssetId}`);
  if (order.failureReason) lines.push(`failure        ${order.failureReason}`);
  // A stale signing URL on a signed or cancelled order only misleads.
  if (order.signingUrl && order.status === "awaiting_signature") {
    lines.push("", `signing url    ${order.signingUrl}`);
  }
  const documents = order.settlementDocuments ?? [];
  if (documents.length > 0) {
    lines.push("", "documents  (download with `lbx orders file <id> <uid>`)");
    for (const document of documents) {
      lines.push(
        `  ${document.uid}  ${document.kind ?? "—"}  ${document.fileName ?? "—"}` +
          (document.size === null || document.size === undefined
            ? ""
            : `  ${formatNumber(document.size)} bytes`),
      );
    }
  }
  return lines;
};

const list: Command = {
  path: ["orders", "list"],
  summary: "Every order on your partner account, newest first",
  usage: "lbx orders list",
  tabular: true,
  async run({ client }): Promise<CommandResult<Order>> {
    const data = await client.get<{ items?: Order[] }>("/v1/partner/orders");
    const items = data.items ?? [];
    return {
      data,
      table: {
        columns: [
          { header: "ID", value: (row) => row.id },
          { header: "STATUS", value: (row) => row.status },
          { header: "OFFER", value: (row) => row.opportunitySlug },
          {
            header: "AMOUNT",
            value: (row) => formatMoney(row.initialAmount),
            raw: (row) => row.initialAmount,
            align: "right",
          },
          { header: "UNITS", value: (row) => row.numberOfUnits, align: "right" },
          {
            header: "TOTAL",
            value: (row) => formatMoney(row.totalAmount),
            raw: (row) => row.totalAmount,
            align: "right",
          },
          { header: "CREATED", value: (row) => formatDateTime(row.createdAt) },
          { header: "CUSTODY ORDER", value: (row) => row.custodyOrderId },
          {
            header: "DOCS",
            value: (row) => row.settlementDocuments?.length ?? 0,
            align: "right",
          },
        ],
        rows: items,
        footer: `${items.length} order(s)`,
      },
    };
  },
};

const get: Command = {
  path: ["orders", "get"],
  summary: "One order: status, economics, history",
  usage: "lbx orders get <id>",
  async run({ client, args }): Promise<CommandResult> {
    const id = requireArg(args, 0, "id", get.usage);
    const data = await client.get<{ order?: Order }>(
      `/v1/partner/orders/${encodeURIComponent(id)}`,
    );
    const order = (data.order ?? data) as Order;
    const history = order.statusHistory ?? [];
    const lines = orderLines(order);
    if (history.length > 0) {
      lines.push("", "history");
      for (const event of history) {
        lines.push(
          `  ${formatDateTime(event.at) ?? "—"}  ${event.status}` +
            (event.by ? `  (${event.by})` : "") +
            (event.note ? `  ${event.note}` : ""),
        );
      }
    }
    return { data, lines };
  },
};

const create: Command = {
  path: ["orders", "create"],
  summary: "Place an order (returns a signing URL)",
  usage: "lbx orders create --opportunity <slug> --amount <usd> [--return-url <url>]",
  options: [
    ["--opportunity <slug>", "Offer to invest in; must be listingType tokenized"],
    ["--amount <usd>", "Pre-fee investment amount in USD"],
    ["--return-url <url>", "Where the e-signature page sends the signatory"],
    [
      "--idempotency-key <key>",
      "Generated (and printed to stderr) when omitted; pass the same one to retry without a second order",
    ],
  ],
  async run({ client, flags, stderr }): Promise<CommandResult> {
    const opportunitySlug =
      getString(flags, "opportunity") ?? getString(flags, "opportunitySlug");
    if (!opportunitySlug) {
      throw new UsageError(`Missing --opportunity.\n  usage: ${create.usage}`);
    }
    const amount = getNumber(flags, "amount");
    if (amount === undefined) {
      throw new UsageError(`Missing --amount.\n  usage: ${create.usage}`);
    }
    if (amount <= 0) throw new UsageError("--amount must be greater than 0");

    const returnUrl = getString(flags, "returnUrl");
    const idempotencyKey =
      getString(flags, "idempotencyKey") ?? crypto.randomUUID();

    const body: Record<string, unknown> = { opportunitySlug, amount };
    if (returnUrl !== undefined) body.returnUrl = returnUrl;

    // Shown before the request leaves, so a call that hangs or dies mid-way
    // can still be retried under the same key.
    stderr(`idempotency-key ${idempotencyKey}`);
    let data: { order?: Order };
    try {
      data = await client.post<{ order?: Order }>("/v1/partner/orders", {
        body,
        headers: { "Idempotency-Key": idempotencyKey },
      });
    } catch (error) {
      if (error instanceof CliError) {
        error.hint(
          `idempotency-key ${idempotencyKey} — retry with --idempotency-key ${idempotencyKey} so a second order cannot be created`,
        );
      }
      throw error;
    }
    const order = (data.order ?? data) as Order;
    return {
      data,
      lines: [...orderLines(order), "", `idempotency key ${idempotencyKey}`],
    };
  },
};

const NOT_SIGNED_YET = /not signed yet/i;
const WAIT_POLL_MS = 10_000;

/**
 * The route is idempotent and takes no body. Its documented 400 "not signed
 * yet" is not a bad request but a race with the signatory, so it exits
 * EX_TEMPFAIL (75) rather than 1; --wait turns that into polling.
 */
const confirmSigning: Command = {
  path: ["orders", "confirm-signing"],
  summary: "Tell LBX the prospectus has been signed",
  usage: "lbx orders confirm-signing <id> [--wait <seconds>]",
  options: [
    ["--wait <seconds>", "While the envelope is unsigned, retry every 10s until signed or the time is up"],
  ],
  async run({ client, args, flags, stderr, sleep, now }): Promise<CommandResult> {
    const id = requireArg(args, 0, "id", confirmSigning.usage);
    const wait = getNumber(flags, "wait");
    if (wait !== undefined && wait < 0) {
      throw new UsageError("--wait must be 0 or more seconds");
    }
    const path = `/v1/partner/orders/${encodeURIComponent(id)}/confirm-signing`;
    const deadline = now() + (wait ?? 0) * 1000;

    for (;;) {
      try {
        const data = await client.post<{ order?: Order }>(path);
        return { data, lines: orderLines((data.order ?? data) as Order) };
      } catch (error) {
        if (!isNotSignedYet(error)) throw error;
        const remaining = deadline - now();
        if (remaining <= 0) {
          throw new CliError(
            `Order ${id} is not signed yet${wait ? ` after ${wait}s` : ""} — have the signatory ` +
              `complete the envelope, then re-run \`lbx orders confirm-signing ${id}\`.`,
            EXIT.TEMPFAIL,
          )
            .hint(`API said: ${error.message}`)
            .hint("--wait <seconds> polls for you; exit 75 means try again later, not a bad request");
        }
        const pause = Math.min(WAIT_POLL_MS, remaining);
        stderr(
          `not signed yet — retrying in ${Math.round(pause / 1000)}s (${Math.round(remaining / 1000)}s left)`,
        );
        await sleep(pause);
      }
    }
  },
};

function isNotSignedYet(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && error.status === 400 && NOT_SIGNED_YET.test(error.message)
  );
}

const resumeSigning: Command = {
  path: ["orders", "resume-signing"],
  summary: "Issue a fresh signing URL (they expire in 5–20 minutes)",
  usage: "lbx orders resume-signing <id> [--return-url <url>]",
  options: [["--return-url <url>", "Where the e-signature page returns to"]],
  async run({ client, args, flags }): Promise<CommandResult> {
    const id = requireArg(args, 0, "id", resumeSigning.usage);
    const returnUrl = getString(flags, "returnUrl");
    const body: Record<string, unknown> = {};
    if (returnUrl !== undefined) body.returnUrl = returnUrl;
    const data = await client.post<{ order?: Order }>(
      `/v1/partner/orders/${encodeURIComponent(id)}/resume-signing`,
      { body },
    );
    return { data, lines: orderLines((data.order ?? data) as Order) };
  },
};

const cancel: Command = {
  path: ["orders", "cancel"],
  summary: "Cancel an unpaid order",
  usage: "lbx orders cancel <id> [--note <text>]",
  options: [["--note <text>", "Reason recorded on the order (max 500 chars)"]],
  async run({ client, args, flags }): Promise<CommandResult> {
    const id = requireArg(args, 0, "id", cancel.usage);
    const note = getString(flags, "note");
    if (note !== undefined && note.length > 500) {
      throw new UsageError("--note must be 500 characters or fewer");
    }
    const body: Record<string, unknown> = {};
    if (note !== undefined) body.note = note;
    const data = await client.post<{ order?: Order }>(
      `/v1/partner/orders/${encodeURIComponent(id)}/cancel`,
      { body },
    );
    return { data, lines: orderLines((data.order ?? data) as Order) };
  },
};

interface LegalDocument {
  key: string;
  title: string;
  size: number | null;
}

const documents: Command = {
  path: ["orders", "documents"],
  summary: "The offer's legal documents for an order",
  usage: "lbx orders documents <id>",
  tabular: true,
  async run({ client, args }): Promise<CommandResult<LegalDocument>> {
    const id = requireArg(args, 0, "id", documents.usage);
    const data = await client.get<{ documents?: LegalDocument[] }>(
      `/v1/partner/orders/${encodeURIComponent(id)}/opportunity-documents`,
    );
    return {
      data,
      table: {
        columns: [
          { header: "TITLE", value: (row) => row.title },
          { header: "KEY", value: (row) => row.key },
          { header: "SIZE", value: (row) => row.size, align: "right" },
        ],
        rows: data.documents ?? [],
      },
    };
  },
};

const documentUrl: Command = {
  path: ["orders", "document-url"],
  summary: "Short-lived download URL for one legal document",
  usage: "lbx orders document-url <id> --key <document-key>",
  options: [["--key <document-key>", "From `lbx orders documents <id>`"]],
  async run({ client, args, flags }): Promise<CommandResult> {
    const id = requireArg(args, 0, "id", documentUrl.usage);
    const key = getString(flags, "key");
    if (!key) {
      throw new UsageError(`Missing --key.\n  usage: ${documentUrl.usage}`);
    }
    const data = await client.get<{ url?: string; expiresIn?: number }>(
      `/v1/partner/orders/${encodeURIComponent(id)}/opportunity-document`,
      { key },
    );
    return {
      data,
      lines: [
        data.url ?? "(no url returned)",
        data.expiresIn ? `expires in ${data.expiresIn}s` : "",
      ].filter((line) => line !== ""),
    };
  },
};

/**
 * The document route streams the file itself (application/pdf), not a URL,
 * so this is the one command that writes to disk. The uid comes from
 * `settlementDocuments[].uid` on `orders get`.
 */
const orderDocument: Command = {
  path: ["orders", "file"],
  summary: "Download a signed prospectus / receipt, once issued",
  usage: "lbx orders file <id> <docUid> [--out <path>]",
  options: [
    [
      "--out <path>",
      "File to write, or a directory to write into (default: the server's filename, else <docUid>.pdf, in the current directory)",
    ],
    ["--out -", "Write the bytes to stdout instead"],
  ],
  async run({ client, args, flags }): Promise<CommandResult> {
    const id = requireArg(args, 0, "id", orderDocument.usage);
    const docUid = requireArg(args, 1, "docUid", orderDocument.usage);
    const out = getString(flags, "out");

    const file = await client.download(
      `/v1/partner/orders/${encodeURIComponent(id)}/documents/${encodeURIComponent(docUid)}`,
    );
    if (out === "-") return { data: null, bytes: file.bytes };

    const target = await resolveTarget(out, file.filename ?? `${basename(docUid)}.pdf`);
    try {
      await writeFile(target, file.bytes);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new CliError(`Cannot write ${target}: ${reason}`);
    }

    const size = file.bytes.byteLength;
    return {
      data: { path: target, bytes: size, contentType: file.contentType ?? null, docUid },
      lines: [
        `wrote ${target}  (${formatNumber(size)} bytes${file.contentType ? `, ${file.contentType}` : ""})`,
      ],
    };
  },
};

/** `--out` names a file, or a directory to drop the suggested filename into. */
async function resolveTarget(out: string | undefined, suggested: string): Promise<string> {
  if (out === undefined) return suggested;
  if (out.endsWith("/")) return join(out, suggested);
  try {
    if ((await stat(out)).isDirectory()) return join(out, suggested);
  } catch {
    // Not there yet: it is the file to create.
  }
  return out;
}

export const orderCommands: Command[] = [
  list,
  get,
  create,
  confirmSigning,
  resumeSigning,
  cancel,
  documents,
  documentUrl,
  orderDocument,
];
