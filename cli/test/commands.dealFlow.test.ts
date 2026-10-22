import { describe, expect, test } from "bun:test";
import { expectOk, runCli } from "./helpers.ts";

// A real-shaped id: negative and past 2^53, which a JS number cannot hold.
const BIG_ID = "-7301948827364519203";

const feed = {
  asOf: "2026-10-20T07:00:12.657Z",
  items: [
    {
      id: BIG_ID,
      companyName: "Example Robotics",
      created: "2026-10-19",
      dealType: "BID",
      pps: 32.5,
      structure: "DIRECT",
      shareClass: "COMMON",
      managementFee: null,
      carry: null,
      verification: false,
      maxNumberOfShares: 2000,
      maxSize: 32500,
      minNumberOfShares: null,
      minSize: null,
      directToClient: false,
      domain: "example.com",
      valuation: 4213977610.25,
      currency: "USD",
    },
    {
      id: "42",
      companyName: "Example Labs",
      created: "2026-10-01",
      dealType: "ASK",
      pps: 400.5,
      structure: "SPV",
      shareClass: "PREFERRED",
      managementFee: 2,
      carry: 20,
      verification: true,
      maxNumberOfShares: null,
      maxSize: 2500000,
      minNumberOfShares: 100,
      minSize: 50000,
      directToClient: true,
      domain: "example.org",
      valuation: null,
      currency: "USD",
    },
  ],
};

describe("deal-flow", () => {
  test("pulls the whole feed in one call", async () => {
    const run = await runCli(["deal-flow"], { body: feed });
    expectOk(run);
    const request = run.stub.only();
    expect(request.path).toBe("/v1/partner/deal-flow");
    expect(request.query).toEqual({});
  });

  test("tabulates every order, ids exact, with the build time in the title", async () => {
    const stdout = expectOk(await runCli(["deal-flow"], { body: feed }));
    expect(stdout).toContain("deal flow — as of 2026-10-20T07:00:12.657Z");
    const robotics = stdout.split("\n").find((l) => l.startsWith(BIG_ID))!;
    expect(robotics).toContain("Example Robotics");
    expect(robotics).toContain("BID");
    expect(robotics).toContain("$4.21B");
    expect(robotics).toContain("—");
    const labs = stdout.split("\n").find((l) => l.startsWith("42 "))!;
    expect(labs).toContain("ASK");
    expect(labs).toContain("$2.50M");
    expect(labs).toContain("20.00%");
    expect(stdout).toContain("2 orders");
  });

  test("--csv keeps the id as written and numbers raw", async () => {
    const stdout = expectOk(await runCli(["deal-flow", "--csv"], { body: feed }));
    const [header, first] = stdout.split("\n");
    expect(header).toStartWith("ID,COMPANY,TYPE,PPS,SIZE,VALUATION");
    expect(first).toStartWith(`${BIG_ID},Example Robotics,BID,32.5,32500,4213977610.25`);
  });

  test("--json returns the body untouched, id still a string", async () => {
    const stdout = expectOk(await runCli(["deal-flow", "--json"], { body: feed }));
    expect(stdout).toContain(`"id": "${BIG_ID}"`);
    expect(JSON.parse(stdout)).toEqual(feed);
  });

  test("an empty feed is a table with no rows, not an error", async () => {
    const stdout = expectOk(await runCli(["deal-flow"], { body: { asOf: null, items: [] } }));
    expect(stdout).toContain("0 orders");
  });

  test("a key without the deal-flow set exits 3, like any 403", async () => {
    const run = await runCli(["deal-flow"], {
      status: 403,
      body: { error: "This partner key does not include deal flow", code: "FORBIDDEN" },
    });
    expect(run.exitCode).toBe(3);
    expect(run.stderr).toContain("FORBIDDEN (HTTP 403)");
  });

  test("a feed not built yet is a 503 the caller can retry", async () => {
    const run = await runCli(["deal-flow"], {
      status: 503,
      body: { error: "The deal feed is temporarily unavailable. Retry later.", code: "UPSTREAM_ERROR" },
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("UPSTREAM_ERROR (HTTP 503)");
  });
});
