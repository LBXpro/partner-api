import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { expectOk, runCli, TEST_ENV } from "./helpers.ts";

const order = {
  id: "order-1",
  status: "awaiting_signature",
  opportunitySlug: "lbx-ai-infrastructure-basket-series",
  opportunityName: "LBX-AI Infrastructure Basket Series",
  initialAmount: 15000,
  numberOfUnits: 20,
  subscriptionPrice: 740,
  tokenIssueFeeAmount: 750,
  adminFeeAmount: 150,
  totalAmount: 15900,
  signingUrl: "https://sign.example/envelope/1",
  failureReason: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  custodyOrderId: null,
  opportunitySnapshot: { slug: "lbx-ai-infrastructure-basket-series", custodyAssetId: null },
  settlementDocuments: [],
  statusHistory: [],
};

const settled = {
  ...order,
  status: "completed",
  custodyOrderId: "cust-order-77",
  opportunitySnapshot: { ...order.opportunitySnapshot, custodyAssetId: "asset-7" },
  settlementDocuments: [
    { uid: "doc-uid-9", fileName: "prospectus-signed.pdf", kind: "prospectus", size: 204800 },
    { uid: "doc-uid-10", fileName: "receipt.pdf", kind: "receipt", size: null },
  ],
};

describe("orders list", () => {
  test("requests the order list", async () => {
    const run = await runCli(["orders", "list"], { body: { items: [order] } });
    expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/orders");
    expect(run.stub.only().method).toBe("GET");
  });

  test("tabulates orders and counts them", async () => {
    const stdout = expectOk(await runCli(["orders", "list"], { body: { items: [order] } }));
    expect(stdout).toContain("order-1");
    expect(stdout).toContain("awaiting_signature");
    expect(stdout).toContain("$15,000");
    expect(stdout).toContain("1 order(s)");
  });

  test("shows the custody order id and document count per row", async () => {
    const stdout = expectOk(await runCli(["orders", "list"], { body: { items: [order, settled] } }));
    expect(stdout.split("\n")[0]).toContain("CUSTODY ORDER");
    const row = stdout.split("\n").find((line) => line.includes("cust-order-77"))!;
    expect(row).toMatch(/cust-order-77\s+2$/);
  });

  test("--csv exports the same columns with raw money", async () => {
    const stdout = expectOk(await runCli(["orders", "list", "--csv"], { body: { items: [settled] } }));
    expect(stdout.split("\n")).toEqual([
      "ID,STATUS,OFFER,AMOUNT,UNITS,TOTAL,CREATED,CUSTODY ORDER,DOCS",
      "order-1,completed,lbx-ai-infrastructure-basket-series,15000,20,15900,2026-09-01T10:00:00Z,cust-order-77,2",
    ]);
  });

  test("handles an account with no orders", async () => {
    const stdout = expectOk(await runCli(["orders", "list"], { body: { items: [] } }));
    expect(stdout).toContain("(no rows)");
    expect(stdout).toContain("0 order(s)");
  });
});

describe("orders get", () => {
  test("requests one order and prints its economics", async () => {
    const run = await runCli(["orders", "get", "order-1"], { body: { order } });
    const stdout = expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/orders/order-1");
    expect(stdout).toContain("order order-1");
    expect(stdout).toContain("status         awaiting_signature");
    expect(stdout).toContain("units          20");
    expect(stdout).toContain("total          $15,900");
    expect(stdout).toContain("signing url    https://sign.example/envelope/1");
  });

  test("prints the status history with who did it and any note", async () => {
    const stdout = expectOk(
      await runCli(["orders", "get", "order-1"], {
        body: {
          order: {
            ...order,
            statusHistory: [
              { status: "created", at: "2026-09-01T09:59:00.000Z", by: "investor", note: null },
              { status: "awaiting_signature", at: "2026-09-01T10:00:00.000Z", by: "system", note: "envelope sent" },
            ],
          },
        },
      }),
    );
    expect(stdout).toContain("history");
    expect(stdout).toContain("2026-09-01T09:59:00Z  created  (investor)");
    expect(stdout).toContain("2026-09-01T10:00:00Z  awaiting_signature  (system)  envelope sent");
  });

  test("shows the custody ids and settlement documents once settled", async () => {
    const stdout = expectOk(await runCli(["orders", "get", "order-1"], { body: { order: settled } }));
    expect(stdout).toContain("custody order  cust-order-77");
    expect(stdout).toContain("custody asset  asset-7");
    expect(stdout).toContain("documents  (download with `lbx orders file <id> <uid>`)");
    expect(stdout).toContain("  doc-uid-9  prospectus  prospectus-signed.pdf  204,800 bytes");
    expect(stdout).toContain("  doc-uid-10  receipt  receipt.pdf");
  });

  test("omits custody lines and the documents section while they are empty", async () => {
    const stdout = expectOk(await runCli(["orders", "get", "order-1"], { body: { order } }));
    expect(stdout).not.toContain("custody");
    expect(stdout).not.toContain("documents");
  });

  test("only prints the signing URL while the order is awaiting signature", async () => {
    const stale = { ...order, status: "awaiting_payment" };
    const stdout = expectOk(await runCli(["orders", "get", "order-1"], { body: { order: stale } }));
    expect(stdout).not.toContain("signing url");
    expect(stdout).not.toContain("https://sign.example/envelope/1");
  });

  test("shows the failure reason on a failed order", async () => {
    const stdout = expectOk(
      await runCli(["orders", "get", "order-1"], {
        body: { order: { ...order, status: "failed", failureReason: "custody rejected" } },
      }),
    );
    expect(stdout).toContain("failure        custody rejected");
  });

  test("requires an id", async () => {
    const run = await runCli(["orders", "get"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("Missing <id>");
    expect(run.requests).toHaveLength(0);
  });
});

describe("orders create", () => {
  test("POSTs the slug and amount with an idempotency key", async () => {
    const run = await runCli(
      ["orders", "create", "--opportunity", "offer-x", "--amount", "15000"],
      { body: { order } },
    );
    expectOk(run);

    const request = run.stub.only();
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v1/partner/orders");
    expect(request.body).toEqual({ opportunitySlug: "offer-x", amount: 15000 });
    expect(request.headers["idempotency-key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("uses the caller's idempotency key when given, and echoes it back", async () => {
    const run = await runCli(
      [
        "orders", "create",
        "--opportunity", "offer-x",
        "--amount", "15000",
        "--idempotency-key", "retry-42",
      ],
      { body: { order } },
    );
    const stdout = expectOk(run);
    expect(run.stub.only().headers["idempotency-key"]).toBe("retry-42");
    expect(stdout).toContain("idempotency key retry-42");
  });

  test("prints the idempotency key to stderr before the request leaves", async () => {
    const events: string[] = [];
    const outcome = await run(
      ["orders", "create", "--opportunity", "offer-x", "--amount", "15000"],
      {
        env: TEST_ENV,
        stderr: (line) => events.push(line),
        fetch: async () => {
          events.push("request");
          return new Response(JSON.stringify({ order }), {
            headers: { "content-type": "application/json" },
          });
        },
      },
    );
    expect(outcome.exitCode).toBe(0);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatch(/^idempotency-key [0-9a-f-]{36}$/);
    expect(events[1]).toBe("request");
  });

  test("a failed create tells you the key to retry with", async () => {
    const run = await runCli(
      ["orders", "create", "--opportunity", "offer-x", "--amount", "15000"],
      { status: 502, body: { error: "Custody unavailable", code: "UPSTREAM_ERROR" } },
    );
    expect(run.exitCode).toBe(1);
    const key = run.notes[0]!.replace("idempotency-key ", "");
    expect(run.stderr).toContain("UPSTREAM_ERROR (HTTP 502): Custody unavailable");
    expect(run.stderr).toContain(`retry with --idempotency-key ${key}`);
  });

  test("a transport failure carries the key too", async () => {
    const outcome = await run(
      ["orders", "create", "--opportunity", "offer-x", "--amount", "15000", "--idempotency-key", "k-9"],
      { env: TEST_ENV, fetch: () => Promise.reject(new Error("socket hang up")) },
    );
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("socket hang up");
    expect(outcome.stderr).toContain("--idempotency-key k-9");
  });

  test("includes returnUrl only when asked", async () => {
    const withUrl = await runCli(
      [
        "orders", "create",
        "--opportunity", "offer-x",
        "--amount", "15000",
        "--return-url", "https://partner.example/signed",
      ],
      { body: { order } },
    );
    expectOk(withUrl);
    expect(withUrl.stub.only().body).toEqual({
      opportunitySlug: "offer-x",
      amount: 15000,
      returnUrl: "https://partner.example/signed",
    });

    const without = await runCli(
      ["orders", "create", "--opportunity", "offer-x", "--amount", "15000"],
      { body: { order } },
    );
    expectOk(without);
    expect(without.stub.only().body).not.toHaveProperty("returnUrl");
  });

  test("prints the signing URL, which is the next step for the partner", async () => {
    const stdout = expectOk(
      await runCli(["orders", "create", "--opportunity", "offer-x", "--amount", "15000"], {
        body: { order },
      }),
    );
    expect(stdout).toContain("signing url    https://sign.example/envelope/1");
  });

  test("requires --opportunity and --amount, and calls nothing without them", async () => {
    const noOffer = await runCli(["orders", "create", "--amount", "15000"]);
    expect(noOffer.exitCode).toBe(64);
    expect(noOffer.stderr).toContain("Missing --opportunity");
    expect(noOffer.requests).toHaveLength(0);

    const noAmount = await runCli(["orders", "create", "--opportunity", "offer-x"]);
    expect(noAmount.exitCode).toBe(64);
    expect(noAmount.stderr).toContain("Missing --amount");
    expect(noAmount.requests).toHaveLength(0);
  });

  test("rejects a non-positive amount locally", async () => {
    const run = await runCli(["orders", "create", "--opportunity", "x", "--amount", "0"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("--amount must be greater than 0");
    expect(run.requests).toHaveLength(0);
  });

  test("sends the amount as a number, not a string", async () => {
    const run = await runCli(
      ["orders", "create", "--opportunity", "x", "--amount", "15000.50"],
      { body: { order } },
    );
    expectOk(run);
    expect((run.stub.only().body as { amount: unknown }).amount).toBe(15000.5);
  });

  test("surfaces a closed subscription without retrying", async () => {
    const run = await runCli(
      ["orders", "create", "--opportunity", "x", "--amount", "15000"],
      {
        status: 400,
        body: { error: "Past the investor deadline", code: "SUBSCRIPTION_CLOSED" },
      },
    );
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("SUBSCRIPTION_CLOSED (HTTP 400)");
    expect(run.requests).toHaveLength(1);
  });

  test("shows validation details when the API rejects the body", async () => {
    const run = await runCli(
      ["orders", "create", "--opportunity", "x", "--amount", "1"],
      {
        status: 400,
        body: {
          error: "Request validation failed",
          code: "VALIDATION_ERROR",
          details: { amount: "below minInvestment" },
        },
      },
    );
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('details: {"amount":"below minInvestment"}');
  });
});

describe("orders confirm-signing", () => {
  const notSignedYet = {
    status: 400,
    body: { error: "Documents not signed yet", code: "VALIDATION_ERROR" },
  };
  const confirmed = { body: { order: { ...order, status: "awaiting_payment" } } };

  /** A clock that only moves when the command sleeps. */
  const fakeTime = () => {
    let clock = 1_000_000;
    const sleeps: number[] = [];
    return {
      sleeps,
      deps: {
        now: () => clock,
        sleep: async (ms: number) => {
          sleeps.push(ms);
          clock += ms;
        },
      },
    };
  };

  test("POSTs to the confirm-signing path with no body", async () => {
    const run = await runCli(["orders", "confirm-signing", "order-1"], confirmed);
    const stdout = expectOk(run);
    const request = run.stub.only();
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v1/partner/orders/order-1/confirm-signing");
    expect(request.body).toBeUndefined();
    expect(request.headers["content-type"]).toBeUndefined();
    expect(stdout).toContain("status         awaiting_payment");
  });

  test("the documented 'not signed yet' 400 exits 75 with what to do next", async () => {
    const run = await runCli(["orders", "confirm-signing", "order-1"], notSignedYet);
    expect(run.exitCode).toBe(75);
    expect(run.stderr).toContain("Order order-1 is not signed yet");
    expect(run.stderr).toContain("re-run `lbx orders confirm-signing order-1`");
    expect(run.stderr).toContain("API said: Documents not signed yet");
    expect(run.stderr).toContain("--wait");
    expect(run.requests).toHaveLength(1);
  });

  test("other 400s keep the ordinary exit code", async () => {
    const run = await runCli(["orders", "confirm-signing", "order-1"], {
      status: 400,
      body: { error: "Order is not awaiting signature", code: "VALIDATION_ERROR" },
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("VALIDATION_ERROR (HTTP 400): Order is not awaiting signature");
  });

  test("--wait polls every 10s until the envelope is signed", async () => {
    const time = fakeTime();
    let attempts = 0;
    const run = await runCli(
      ["orders", "confirm-signing", "order-1", "--wait", "60"],
      () => (++attempts < 3 ? notSignedYet : confirmed),
      { deps: time.deps },
    );
    const stdout = expectOk(run);
    expect(run.requests).toHaveLength(3);
    expect(time.sleeps).toEqual([10_000, 10_000]);
    expect(run.notes).toEqual([
      "not signed yet — retrying in 10s (60s left)",
      "not signed yet — retrying in 10s (50s left)",
    ]);
    expect(stdout).toContain("status         awaiting_payment");
  });

  test("--wait gives up at the deadline with exit 75, never sleeping past it", async () => {
    const time = fakeTime();
    const run = await runCli(
      ["orders", "confirm-signing", "order-1", "--wait", "25"],
      notSignedYet,
      { deps: time.deps },
    );
    expect(run.exitCode).toBe(75);
    expect(time.sleeps).toEqual([10_000, 10_000, 5_000]);
    expect(run.requests).toHaveLength(4);
    expect(run.stderr).toContain("not signed yet after 25s");
  });

  test("--wait does not retry errors that will not fix themselves", async () => {
    const time = fakeTime();
    const run = await runCli(
      ["orders", "confirm-signing", "order-1", "--wait", "60"],
      { status: 404, body: { error: "Order not found", code: "NOT_FOUND" } },
      { deps: time.deps },
    );
    expect(run.exitCode).toBe(1);
    expect(run.requests).toHaveLength(1);
    expect(time.sleeps).toEqual([]);
  });

  test("a negative --wait is a usage error", async () => {
    const run = await runCli(["orders", "confirm-signing", "order-1", "--wait", "-5"]);
    expect(run.exitCode).toBe(64);
    expect(run.requests).toHaveLength(0);
  });

  test("requires an id", async () => {
    const run = await runCli(["orders", "confirm-signing"]);
    expect(run.exitCode).toBe(64);
    expect(run.requests).toHaveLength(0);
  });
});

describe("orders resume-signing", () => {
  const refreshed = { body: { order: { ...order, signingUrl: "https://sign.example/envelope/2" } } };

  test("POSTs an empty body by default and prints the order with its fresh URL", async () => {
    const run = await runCli(["orders", "resume-signing", "order-1"], refreshed);
    const stdout = expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/orders/order-1/resume-signing");
    expect(run.stub.only().body).toEqual({});
    expect(stdout).toContain("status         awaiting_signature");
    expect(stdout).toContain("signing url    https://sign.example/envelope/2");
  });

  test("passes --return-url through", async () => {
    const run = await runCli(
      ["orders", "resume-signing", "order-1", "--return-url", "https://p.example/done"],
      refreshed,
    );
    expectOk(run);
    expect(run.stub.only().body).toEqual({ returnUrl: "https://p.example/done" });
  });

  test("requires an id", async () => {
    const run = await runCli(["orders", "resume-signing"]);
    expect(run.exitCode).toBe(64);
    expect(run.requests).toHaveLength(0);
  });
});

describe("orders cancel", () => {
  test("POSTs to cancel and reports the new status", async () => {
    const run = await runCli(["orders", "cancel", "order-1"], {
      body: { order: { ...order, status: "cancelled" } },
    });
    const stdout = expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/orders/order-1/cancel");
    expect(run.stub.only().body).toEqual({});
    expect(stdout).toContain("status         cancelled");
  });

  test("sends --note when given", async () => {
    const run = await runCli(["orders", "cancel", "order-1", "--note", "changed mind"], {
      body: { order: { ...order, status: "cancelled" } },
    });
    expectOk(run);
    expect(run.stub.only().body).toEqual({ note: "changed mind" });
  });

  test("rejects a note over the documented 500-character limit", async () => {
    const run = await runCli(["orders", "cancel", "order-1", "--note", "x".repeat(501)]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("500 characters or fewer");
    expect(run.requests).toHaveLength(0);
  });

  test("accepts a note of exactly 500 characters", async () => {
    const run = await runCli(["orders", "cancel", "order-1", "--note", "x".repeat(500)], {
      body: { order },
    });
    expectOk(run);
    expect(run.requests).toHaveLength(1);
  });

  test("requires an id", async () => {
    const run = await runCli(["orders", "cancel"]);
    expect(run.exitCode).toBe(64);
    expect(run.requests).toHaveLength(0);
  });
});

describe("orders documents", () => {
  test("lists the offer's legal documents", async () => {
    const run = await runCli(["orders", "documents", "order-1"], {
      body: {
        opportunitySlug: "offer-x",
        opportunityName: "Offer X",
        documents: [{ key: "docs/abc.pdf", title: "Subscription T&Cs", size: 346415 }],
      },
    });
    const stdout = expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/orders/order-1/opportunity-documents");
    expect(stdout).toContain("Subscription T&Cs");
    expect(stdout).toContain("docs/abc.pdf");
  });

  test("requires an id", async () => {
    const run = await runCli(["orders", "documents"]);
    expect(run.exitCode).toBe(64);
    expect(run.requests).toHaveLength(0);
  });
});

describe("orders document-url", () => {
  const presigned = { url: "https://files.example/abc.pdf?sig=1", expiresIn: 300 };

  test("passes the document key as a query parameter", async () => {
    const run = await runCli(
      ["orders", "document-url", "order-1", "--key", "docs/abc.pdf"],
      { body: presigned },
    );
    const stdout = expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/orders/order-1/opportunity-document");
    expect(run.stub.only().query.key).toEqual(["docs/abc.pdf"]);
    expect(stdout).toContain("https://files.example/abc.pdf?sig=1");
    expect(stdout).toContain("expires in 300s");
  });

  test("the key is --key only; a stray positional is not silently used", async () => {
    const run = await runCli(["orders", "document-url", "order-1", "docs/abc.pdf"], {
      body: presigned,
    });
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("Missing --key");
    expect(run.requests).toHaveLength(0);
  });

  test("--key does not collide with the API key flag", async () => {
    const run = await runCli(
      ["orders", "document-url", "order-1", "--key", "docs/abc.pdf"],
      { body: presigned },
    );
    expectOk(run);
    expect(run.stub.only().headers.authorization).toBe("Bearer lbx_stg_test");
  });

  test("requires a key", async () => {
    const run = await runCli(["orders", "document-url", "order-1"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("Missing --key");
    expect(run.requests).toHaveLength(0);
  });
});

describe("orders file", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
  const streamed = {
    bytes: pdf,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="prospectus-signed.pdf"',
    },
  };
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lbx-cli-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("GETs the document route asking for a file, not JSON", async () => {
    const run = await runCli(["orders", "file", "order-1", "doc-uid-9", "--out", join(dir, "x.pdf")], streamed);
    expectOk(run);
    const request = run.stub.only();
    expect(request.method).toBe("GET");
    expect(request.path).toBe("/v1/partner/orders/order-1/documents/doc-uid-9");
    expect(request.headers.accept).toContain("application/pdf");
    expect(request.headers.authorization).toBe("Bearer lbx_stg_test");
  });

  test("--out <path> writes the bytes verbatim and reports the size", async () => {
    const target = join(dir, "signed.pdf");
    const run = await runCli(["orders", "file", "order-1", "doc-uid-9", "--out", target], streamed);
    const stdout = expectOk(run);
    expect(new Uint8Array(readFileSync(target))).toEqual(pdf);
    expect(stdout).toBe(`wrote ${target}  (${pdf.byteLength} bytes, application/pdf)`);
  });

  test("--out <dir> keeps the filename the server suggested", async () => {
    const run = await runCli(["orders", "file", "order-1", "doc-uid-9", "--out", dir], streamed);
    expectOk(run);
    expect(existsSync(join(dir, "prospectus-signed.pdf"))).toBe(true);
  });

  test("falls back to <docUid>.pdf when there is no Content-Disposition", async () => {
    const run = await runCli(["orders", "file", "order-1", "doc-uid-9", "--out", `${dir}/`], {
      bytes: pdf,
      headers: { "content-type": "application/pdf" },
    });
    expectOk(run);
    expect(existsSync(join(dir, "doc-uid-9.pdf"))).toBe(true);
  });

  test("a Content-Disposition path cannot escape the target directory", async () => {
    const run = await runCli(["orders", "file", "order-1", "doc-uid-9", "--out", dir], {
      bytes: pdf,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="../escaped.pdf"',
      },
    });
    expectOk(run);
    expect(existsSync(join(dir, "escaped.pdf"))).toBe(true);
    expect(existsSync(join(dir, "..", "escaped.pdf"))).toBe(false);
  });

  test("--out - streams the bytes to stdout and prints nothing else", async () => {
    const run = await runCli(["orders", "file", "order-1", "doc-uid-9", "--out", "-"], streamed);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stdoutBytes).toEqual(pdf);
  });

  test("--json describes what was written rather than dumping the PDF", async () => {
    const target = join(dir, "x.pdf");
    const run = await runCli(["orders", "file", "order-1", "doc-uid-9", "--out", target, "--json"], streamed);
    const stdout = expectOk(run);
    expect(JSON.parse(stdout)).toEqual({
      path: target,
      bytes: pdf.byteLength,
      contentType: "application/pdf",
      docUid: "doc-uid-9",
    });
  });

  test("the error envelope still comes through when there is nothing to download", async () => {
    const run = await runCli(["orders", "file", "order-1", "doc-uid-9", "--out", dir], {
      status: 400,
      body: { error: "Order has no custody-side documents yet", code: "VALIDATION_ERROR" },
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("VALIDATION_ERROR (HTTP 400): Order has no custody-side documents yet");
    expect(existsSync(join(dir, "doc-uid-9.pdf"))).toBe(false);
  });

  test("an unwritable target is a clear error, not a stack trace", async () => {
    const run = await runCli(
      ["orders", "file", "order-1", "doc-uid-9", "--out", join(dir, "missing", "x.pdf")],
      streamed,
    );
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toStartWith("Cannot write ");
    expect(run.stderr).not.toContain("    at ");
  });

  test("requires both the order id and the doc uid", async () => {
    const run = await runCli(["orders", "file", "order-1"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("Missing <docUid>");
    expect(run.requests).toHaveLength(0);
  });
});
