import { describe, expect, test } from "bun:test";
import { expectOk, runCli } from "./helpers.ts";

const listBody = {
  total: 967,
  items: [
    {
      slug: "anthropic",
      name: "Anthropic",
      industry: "Artificial Intelligence",
      cohort: "liquid",
      inLBX25: true,
      launchbayPrice: 871.21,
      impliedValuation: 1_427_340_197_959,
      secondaryPremium: 47.91,
      activityScore: 90,
      lastRound: "Later Stage VC",
      lastRoundDate: "2026-05-27T00:00:00.000Z",
    },
    {
      slug: "quiet-co",
      name: "Quiet Co",
      industry: null,
      cohort: null,
      inLBX25: false,
      launchbayPrice: null,
      impliedValuation: null,
      secondaryPremium: null,
      activityScore: null,
      lastRound: null,
      lastRoundDate: null,
    },
  ],
};

describe("companies list", () => {
  test("calls the catalog with no filters by default", async () => {
    const run = await runCli(["companies", "list"], { body: listBody });
    expectOk(run);
    const request = run.stub.only();
    expect(request.path).toBe("/v1/partner/companies");
    expect(request.query).toEqual({});
  });

  test("maps every filter flag onto its API parameter", async () => {
    const run = await runCli(
      [
        "companies", "list",
        "--search", "ai",
        "--industry", "SaaS",
        "--industry", "FinTech",
        "--cohort", "liquid",
        "--in-lbx25",
        "--min-valuation", "1000",
        "--max-valuation", "2000",
        "--min-premium", "-10",
        "--max-premium", "50",
        "--min-activity", "1",
        "--max-activity", "99",
        "--date-from", "2025-01-01",
        "--date-to", "2026-01-01",
        "--sort-by", "impliedValuation",
        "--sort-order", "desc",
        "--limit", "50",
        "--offset", "100",
      ],
      { body: listBody },
    );
    expectOk(run);

    expect(run.stub.only().query).toEqual({
      search: ["ai"],
      industry: ["SaaS", "FinTech"],
      cohort: ["liquid"],
      inLBX25: ["true"],
      minValuation: ["1000"],
      maxValuation: ["2000"],
      minSecondaryPremium: ["-10"],
      maxSecondaryPremium: ["50"],
      minActivityScore: ["1"],
      maxActivityScore: ["99"],
      dateFrom: ["2025-01-01"],
      dateTo: ["2026-01-01"],
      sortBy: ["impliedValuation"],
      sortOrder: ["desc"],
      limit: ["50"],
      offset: ["100"],
    });
  });

  test("--no-in-lbx25 asks for the complement", async () => {
    const run = await runCli(["companies", "list", "--no-in-lbx25"], { body: listBody });
    expectOk(run);
    expect(run.stub.only().query.inLBX25).toEqual(["false"]);
  });

  test("renders a table with compact valuations and a total footer", async () => {
    const stdout = expectOk(await runCli(["companies", "list"], { body: listBody }));
    expect(stdout).toContain("anthropic");
    expect(stdout).toContain("$1.43T");
    expect(stdout).toContain("47.91%");
    expect(stdout).toContain("2 of 967");
  });

  test("renders unknown values as an em dash, not zero", async () => {
    const stdout = expectOk(await runCli(["companies", "list"], { body: listBody }));
    const quietRow = stdout.split("\n").find((line) => line.startsWith("quiet-co"))!;
    expect(quietRow).toContain("—");
    expect(quietRow).not.toContain("$0");
  });

  test("falls back to a count when the API omits total", async () => {
    const stdout = expectOk(
      await runCli(["companies", "list"], { body: { ...listBody, total: null } }),
    );
    expect(stdout).toContain("2 shown");
  });

  test("--json prints the payload untouched", async () => {
    const stdout = expectOk(await runCli(["companies", "list", "--json"], { body: listBody }));
    expect(JSON.parse(stdout)).toEqual(listBody);
  });

  test("--csv emits raw numbers for spreadsheets", async () => {
    const stdout = expectOk(await runCli(["companies", "list", "--csv"], { body: listBody }));
    const lines = stdout.split("\n");
    expect(lines[0]).toBe("SLUG,NAME,INDUSTRY,LBX25,PRICE,VALUATION,PREMIUM,LAST ROUND");
    expect(lines[1]).toBe(
      "anthropic,Anthropic,Artificial Intelligence,yes,871.21,1427340197959,47.91,2026-05-27",
    );
  });

  test("rejects a limit outside the documented 1–200 range before calling the API", async () => {
    const run = await runCli(["companies", "list", "--limit", "201"], { body: listBody });
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("--limit must be between 1 and 200");
    expect(run.requests).toHaveLength(0);
  });

  test("rejects a non-numeric limit", async () => {
    const run = await runCli(["companies", "list", "--limit", "many"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("--limit must be a number");
  });

  test("rejects an unknown sort order", async () => {
    const run = await runCli(["companies", "list", "--sort-order", "sideways"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain('--sort-order must be "asc" or "desc"');
    expect(run.requests).toHaveLength(0);
  });

  test("surfaces an API validation error with its code", async () => {
    const run = await runCli(["companies", "list", "--sort-by", "bogus"], {
      status: 400,
      body: { error: "Request validation failed", code: "VALIDATION_ERROR" },
      headers: { "x-request-id": "req-9" },
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("VALIDATION_ERROR (HTTP 400)");
    expect(run.stderr).toContain("x-request-id: req-9");
  });
});

describe("companies get", () => {
  const detail = {
    company: {
      slug: "anthropic",
      name: "Anthropic",
      industry: "Artificial Intelligence",
      cohort: "liquid",
      inLBX25: true,
      launchbayPrice: 871.21,
      impliedValuation: 1_427_340_197_959,
      secondaryPremium: 47.91,
      lastRound: "Later Stage VC",
      lastRoundDate: "2026-05-27T00:00:00.000Z",
    },
  };

  test("requests the slug path", async () => {
    const run = await runCli(["companies", "get", "anthropic"], { body: detail });
    expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/companies/anthropic");
  });

  test("URL-encodes an awkward slug", async () => {
    const run = await runCli(["companies", "get", "a b/c"], { body: detail });
    expectOk(run);
    expect(run.stub.only().url).toContain("/v1/partner/companies/a%20b%2Fc");
  });

  test("summarises the company for humans", async () => {
    const stdout = expectOk(await runCli(["companies", "get", "anthropic"], { body: detail }));
    expect(stdout).toContain("Anthropic  (anthropic)");
    expect(stdout).toContain("in LBX25     yes");
    expect(stdout).toContain("valuation    $1.43T");
    expect(stdout).toContain("last round   Later Stage VC 2026-05-27");
  });

  test("reads a flat payload too, in case the envelope changes", async () => {
    const stdout = expectOk(
      await runCli(["companies", "get", "anthropic"], { body: detail.company }),
    );
    expect(stdout).toContain("Anthropic  (anthropic)");
  });

  test("without a slug it prints usage and never calls the API", async () => {
    const run = await runCli(["companies", "get"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("Missing <slug>");
    expect(run.stderr).toContain("usage: lbx companies get <slug>");
    expect(run.requests).toHaveLength(0);
  });

  test("passes a 404 through with its message", async () => {
    const run = await runCli(["companies", "get", "nope"], {
      status: 404,
      body: { error: 'Company with identifier "nope" not found', code: "NOT_FOUND" },
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("NOT_FOUND (HTTP 404)");
  });
});

describe("companies charts", () => {
  const charts = {
    pricingHistory: [
      { date: "2026-08-01T00:00:00.000Z", price: 800, valuation: 1_000_000_000, premium: 12.5 },
      { date: "2026-09-01T00:00:00.000Z", price: null, valuation: null, premium: null },
    ],
    fundingRounds: [
      { date: "2025-03-01T00:00:00.000Z", round: "Series E", size: 3_500_000_000, valuation: 61_500_000_000, pps: 56.09 },
    ],
  };

  test("requests the charts path", async () => {
    const run = await runCli(["companies", "charts", "anthropic"], { body: charts });
    expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/companies/anthropic/charts");
  });

  test("tabulates the pricing series", async () => {
    const stdout = expectOk(await runCli(["companies", "charts", "anthropic"], { body: charts }));
    expect(stdout).toContain("2026-08-01");
    expect(stdout).toContain("$800");
    expect(stdout).toContain("$1.00B");
    expect(stdout).toContain("12.50%");
  });

  test("renders the funding rounds under the pricing series", async () => {
    const stdout = expectOk(await runCli(["companies", "charts", "anthropic"], { body: charts }));
    expect(stdout.indexOf("pricing\nDATE")).toBeGreaterThanOrEqual(0);
    expect(stdout.indexOf("funding rounds\nDATE")).toBeGreaterThan(stdout.indexOf("pricing\nDATE"));
    const round = stdout.split("\n").find((line) => line.includes("Series E"))!;
    expect(round).toContain("2025-03-01");
    expect(round).toContain("$3.50B");
    expect(round).toContain("$61.50B");
    expect(round).toContain("$56.09");
  });

  test("--csv exports the pricing series only", async () => {
    const stdout = expectOk(await runCli(["companies", "charts", "anthropic", "--csv"], { body: charts }));
    expect(stdout.split("\n")).toEqual([
      "DATE,PRICE,VALUATION,PREMIUM",
      "2026-08-01,800,1000000000,12.5",
      "2026-09-01,,,",
    ]);
  });

  test("copes with an empty series and no rounds", async () => {
    const stdout = expectOk(
      await runCli(["companies", "charts", "anthropic"], { body: { pricingHistory: [] } }),
    );
    expect(stdout).toContain("(no rows)");
    expect(stdout).toContain("funding rounds");
  });

  test("requires a slug", async () => {
    const run = await runCli(["companies", "charts"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("Missing <slug>");
  });
});

describe("companies funding", () => {
  const funding = {
    rounds: [
      {
        round: "Series A",
        date: "2021-05-28T00:00:00.000Z",
        roundSize: 124_000_000,
        valuation: 674_000_000,
        pricePerShare: 2.57,
      },
    ],
  };

  test("requests the funding path and tabulates rounds", async () => {
    const run = await runCli(["companies", "funding", "anthropic"], { body: funding });
    const stdout = expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/companies/anthropic/funding");
    expect(stdout).toContain("Series A");
    expect(stdout).toContain("$124.00M");
    expect(stdout).toContain("$2.57");
  });

  test("requires a slug", async () => {
    const run = await runCli(["companies", "funding"]);
    expect(run.exitCode).toBe(64);
    expect(run.requests).toHaveLength(0);
  });
});
