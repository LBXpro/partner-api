import { describe, expect, test } from "bun:test";
import { expectOk, runCli } from "./helpers.ts";

const position = {
  id: "pos-1",
  orderId: "order-1",
  opportunitySlug: "offer-x",
  opportunityName: "Offer X",
  numberOfUnits: 20,
  initialAmount: 15000,
  positionValue: 16500,
  pnlVsSubscriptionPct: 10,
  custodyAssetId: "asset-7",
  createdAt: "2026-06-01T00:00:00.000Z",
};

const portfolio = {
  summary: {
    investedTotal: 15000,
    valueTotal: 16500,
    gain: 1500,
    gainPct: 10,
    activePositions: 1,
  },
  positions: [position],
  holdings: [
    {
      opportunitySlug: "offer-x",
      opportunityName: "Offer X",
      domainName: "offer-x.example",
      numberOfUnits: 20,
      investedTotal: 15000,
      positionValue: 16500,
      pnlVsSubscriptionPct: 10,
      custodyAssetId: "asset-7",
      lots: [position],
    },
  ],
};

describe("portfolio show", () => {
  test("requests the portfolio", async () => {
    const run = await runCli(["portfolio", "show"], { body: portfolio });
    expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/portfolio");
  });

  test("leads with holdings per offer, then the lots, then the totals", async () => {
    const stdout = expectOk(await runCli(["portfolio", "show"], { body: portfolio }));
    const holdingsAt = stdout.indexOf("holdings\nOFFER");
    const lotsAt = stdout.indexOf("lots\nPOSITION");
    expect(holdingsAt).toBeGreaterThanOrEqual(0);
    expect(lotsAt).toBeGreaterThan(holdingsAt);

    const holdingRow = stdout.split("\n").find((line) => line.startsWith("offer-x"))!;
    expect(holdingRow).toContain("Offer X");
    expect(holdingRow).toContain("$16,500");
    expect(holdingRow).toContain("10.00%");
    expect(holdingRow).toContain("asset-7");
    expect(holdingRow).toMatch(/\s1\s+asset-7/); // LOTS

    expect(stdout).toContain("pos-1");
    expect(stdout).toContain("order-1");
    expect(stdout).toContain("invested $15,000");
    expect(stdout).toContain("across 1 position(s)");
  });

  test("--lots tabulates the positions alone", async () => {
    const stdout = expectOk(await runCli(["portfolio", "show", "--lots"], { body: portfolio }));
    expect(stdout).toStartWith("POSITION");
    expect(stdout).not.toContain("holdings");
    expect(stdout).toContain("pos-1");
    expect(stdout).toContain("across 1 position(s)");
  });

  test("reads an empty portfolio without dividing by zero", async () => {
    const stdout = expectOk(
      await runCli(["portfolio", "show"], {
        body: {
          summary: { investedTotal: 0, valueTotal: 0, gain: 0, gainPct: 0, activePositions: 0 },
          positions: [],
          holdings: [],
        },
      }),
    );
    expect(stdout).toContain("(no rows)");
    expect(stdout).toContain("across 0 position(s)");
  });

  test("copes with a summary the API left out entirely", async () => {
    const stdout = expectOk(await runCli(["portfolio", "show"], { body: { positions: [] } }));
    expect(stdout).toContain("invested —");
    expect(stdout).toContain("across 0 position(s)");
  });

  test("--csv exports holdings with raw money and percentages", async () => {
    const stdout = expectOk(await runCli(["portfolio", "show", "--csv"], { body: portfolio }));
    expect(stdout.split("\n")).toEqual([
      "OFFER,NAME,UNITS,INVESTED,VALUE,P&L,LOTS,CUSTODY ASSET",
      "offer-x,Offer X,20,15000,16500,10,1,asset-7",
    ]);
  });

  test("--csv --lots exports the positions with raw values", async () => {
    const stdout = expectOk(await runCli(["portfolio", "show", "--csv", "--lots"], { body: portfolio }));
    expect(stdout.split("\n")[1]).toBe("pos-1,offer-x,20,15000,16500,10,2026-06-01,order-1");
  });
});

describe("portfolio history", () => {
  const history = {
    points: [
      { date: "2026-08-01T00:00:00.000Z", portfolioValue: 15200 },
      { date: "2026-09-01T00:00:00.000Z", portfolioValue: 16500 },
    ],
  };

  test("requests the history path", async () => {
    const run = await runCli(["portfolio", "history"], { body: history });
    expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/portfolio/history");
  });

  test("tabulates portfolioValue over time", async () => {
    const stdout = expectOk(await runCli(["portfolio", "history"], { body: history }));
    expect(stdout).toContain("2026-09-01");
    expect(stdout).toContain("$16,500");
    expect(stdout).toContain("2 point(s)");
  });

  test("--csv keeps the value numeric", async () => {
    const stdout = expectOk(await runCli(["portfolio", "history", "--csv"], { body: history }));
    expect(stdout.split("\n")).toEqual(["DATE,VALUE", "2026-08-01,15200", "2026-09-01,16500"]);
  });

  test("handles a portfolio with no history yet", async () => {
    const stdout = expectOk(await runCli(["portfolio", "history"], { body: { points: [] } }));
    expect(stdout).toContain("0 point(s)");
  });
});

describe("positions history", () => {
  const history = {
    points: [
      {
        date: "2026-09-01T00:00:00.000Z",
        positionValue: 16500,
        pnlVsSubscriptionPct: 10,
        launchbayPricePerShare: 825,
        impliedValuation: 2_000_000_000,
      },
    ],
  };

  test("requests one position's history", async () => {
    const run = await runCli(["positions", "history", "pos-1"], { body: history });
    expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/positions/pos-1/history");
  });

  test("tabulates positionValue with its P&L, LBX price and valuation", async () => {
    const stdout = expectOk(await runCli(["positions", "history", "pos-1"], { body: history }));
    const row = stdout.split("\n").find((line) => line.startsWith("2026-09-01"))!;
    expect(row).toContain("$16,500");
    expect(row).toContain("10.00%");
    expect(row).toContain("$825");
    expect(row).toContain("$2.00B");
    expect(stdout).toContain("1 point(s)");
  });

  test("--csv exports the raw numbers", async () => {
    const stdout = expectOk(await runCli(["positions", "history", "pos-1", "--csv"], { body: history }));
    expect(stdout.split("\n")[1]).toBe("2026-09-01,16500,10,825,2000000000");
  });

  test("a response with no points is an empty table, not a crash", async () => {
    const stdout = expectOk(await runCli(["positions", "history", "pos-1"], { body: { points: [] } }));
    expect(stdout).toContain("(no rows)");
    expect(stdout).toContain("0 point(s)");
  });

  test("requires a position id", async () => {
    const run = await runCli(["positions", "history"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("Missing <position-id>");
    expect(run.requests).toHaveLength(0);
  });

  test("passes a 404 for an unknown position through", async () => {
    const run = await runCli(["positions", "history", "000000000000000000000000"], {
      status: 404,
      body: { error: "Position not found", code: "NOT_FOUND" },
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("NOT_FOUND (HTTP 404)");
  });
});
