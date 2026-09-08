import { describe, expect, test } from "bun:test";
import { expectOk, runCli } from "./helpers.ts";

const indexes = {
  items: [
    {
      id: "6953d7512880a8344dc9979d",
      indexName: "LBX25 Index",
      indexType: "LBX25",
      currentValue: 3850.259401,
      initialValue: 1000,
      oneMonthPerformance: 0.05,
      threeMonthPerformance: 0.07,
      oneYearPerformance: 0.73,
      totalHoldings: 25,
    },
    {
      id: "6953d7532880a8344dc9979f",
      indexName: "S&P 500",
      indexType: "sp500",
      currentValue: null,
      initialValue: null,
      oneMonthPerformance: null,
      threeMonthPerformance: null,
      oneYearPerformance: null,
      totalHoldings: null,
    },
  ],
};

describe("indexes list", () => {
  test("requests the index list", async () => {
    const run = await runCli(["indexes", "list"], { body: indexes });
    expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/indexes");
    expect(run.stub.only().query).toEqual({});
  });

  test("shows level and performance, dashing out missing metrics", async () => {
    const stdout = expectOk(await runCli(["indexes", "list"], { body: indexes }));
    expect(stdout).toContain("LBX25 Index");
    expect(stdout).toContain("3,850.26");
    expect(stdout).toContain("0.05%");
    const sp500 = stdout.split("\n").find((line) => line.includes("S&P 500"))!;
    expect(sp500).toContain("—");
  });

  test("--json returns the payload", async () => {
    const stdout = expectOk(await runCli(["indexes", "list", "--json"], { body: indexes }));
    expect(JSON.parse(stdout)).toEqual(indexes);
  });

  test("--csv emits performance as raw numbers, not percent strings", async () => {
    const stdout = expectOk(await runCli(["indexes", "list", "--csv"], { body: indexes }));
    expect(stdout.split("\n")).toEqual([
      "ID,NAME,TYPE,LEVEL,1M,3M,1Y,HOLDINGS",
      "6953d7512880a8344dc9979d,LBX25 Index,LBX25,3850.259401,0.05,0.07,0.73,25",
      "6953d7532880a8344dc9979f,S&P 500,sp500,,,,,",
    ]);
  });

  test("handles an empty index list", async () => {
    const stdout = expectOk(await runCli(["indexes", "list"], { body: { items: [] } }));
    expect(stdout).toContain("(no rows)");
  });
});

describe("indexes history", () => {
  const history = {
    history: [
      { date: "2026-08-15T00:00:00.000Z", value: 3866.88 },
      { date: "2026-09-01T00:00:00.000Z", value: 3850.26 },
    ],
  };

  test("takes the index id from the positional", async () => {
    const run = await runCli(["indexes", "history", "lbx25"], { body: history });
    expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/indexes/lbx25/history");
    expect(run.stub.only().query).toEqual({});
  });

  test("passes --months through", async () => {
    const run = await runCli(["indexes", "history", "lbx25", "--months", "6"], {
      body: history,
    });
    expectOk(run);
    expect(run.stub.only().query.months).toEqual(["6"]);
  });

  test("rejects a fractional --months", async () => {
    const run = await runCli(["indexes", "history", "lbx25", "--months", "2.5"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("--months must be a whole number");
    expect(run.requests).toHaveLength(0);
  });

  test("encodes an id with awkward characters", async () => {
    const run = await runCli(["indexes", "history", "a/b"], { body: history });
    expectOk(run);
    expect(run.stub.only().url).toContain("/v1/partner/indexes/a%2Fb/history");
  });

  test("tabulates the series and counts the points", async () => {
    const stdout = expectOk(await runCli(["indexes", "history", "lbx25"], { body: history }));
    expect(stdout).toContain("2026-09-01");
    expect(stdout).toContain("3,850.26");
    expect(stdout).toContain("2 point(s)");
  });

  test("requires an id", async () => {
    const run = await runCli(["indexes", "history"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("Missing <id>");
    expect(run.requests).toHaveLength(0);
  });

  test("passes a 404 for an unknown index through", async () => {
    const run = await runCli(["indexes", "history", "nope"], {
      status: 404,
      body: { error: "Index not found", code: "NOT_FOUND" },
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("NOT_FOUND (HTTP 404): Index not found");
  });
});
