import { describe, expect, test } from "bun:test";
import { expectOk, runCli } from "./helpers.ts";

const offers = {
  items: [
    {
      slug: "LBX-Space-Tech",
      displayName: "LBX Space Tech",
      tagline: "Space, but investable",
      type: "portfolio",
      listingType: "non-tokenized",
      visibility: "public",
      minInvestment: 15000,
      economics: {
        subscriptionPrice: 810,
        minInvestment: 15000,
        maxInvestment: null,
        displayStatus: "coming_soon",
        investorDeadline: null,
      },
    },
    {
      slug: "lbx-ai-infrastructure-basket-series",
      displayName: "LBX-AI Infrastructure Basket Series",
      tagline: "A single entry point to AI infrastructure investment",
      type: "portfolio",
      listingType: "tokenized",
      visibility: "public",
      minInvestment: 15000,
      economics: {
        subscriptionPrice: 740,
        minInvestment: 15000,
        maxInvestment: null,
        tokenIssueFeePct: 5,
        adminFeePct: 1,
        adminFeeYears: 1,
        forQualifiedOnly: true,
        displayStatus: "active",
        investorDeadline: "2026-09-23T23:59:59.999Z",
      },
    },
  ],
};

describe("opportunities list", () => {
  test("requests the offers path", async () => {
    const run = await runCli(["opportunities", "list"], { body: offers });
    expectOk(run);
    expect(run.stub.only().path).toBe("/v1/partner/opportunities");
  });

  test("marks only tokenized offers as orderable", async () => {
    const stdout = expectOk(await runCli(["opportunities", "list"], { body: offers }));
    const spaceRow = stdout.split("\n").find((l) => l.startsWith("LBX-Space-Tech"))!;
    const aiRow = stdout.split("\n").find((l) => l.startsWith("lbx-ai-infra"))!;
    expect(spaceRow).toContain("non-tokenized");
    expect(spaceRow).toMatch(/\bno\b/);
    expect(aiRow).toContain("tokenized");
    expect(aiRow).toMatch(/\byes\b/);
    expect(stdout).toContain("2 offer(s), 1 orderable");
  });

  test("shows economics pulled out of the nested object", async () => {
    const stdout = expectOk(await runCli(["opportunities", "list"], { body: offers }));
    expect(stdout).toContain("$15,000");
    expect(stdout).toContain("$740");
    expect(stdout).toContain("2026-09-23");
    expect(stdout).toContain("active");
  });

  test("--csv exports the raw min and unit price", async () => {
    const stdout = expectOk(await runCli(["opportunities", "list", "--csv"], { body: offers }));
    expect(stdout.split("\n")[2]).toContain(",15000,740,");
  });

  test("handles no offers at all", async () => {
    const stdout = expectOk(await runCli(["opportunities", "list"], { body: { items: [] } }));
    expect(stdout).toContain("(no rows)");
    expect(stdout).toContain("0 offer(s), 0 orderable");
  });
});

describe("opportunities get", () => {
  const detail = { opportunity: offers.items[1] };

  test("requests the slug path", async () => {
    const run = await runCli(
      ["opportunities", "get", "lbx-ai-infrastructure-basket-series"],
      { body: detail },
    );
    expectOk(run);
    expect(run.stub.only().path).toBe(
      "/v1/partner/opportunities/lbx-ai-infrastructure-basket-series",
    );
  });

  test("spells out the terms, including orderability", async () => {
    const stdout = expectOk(
      await runCli(["opportunities", "get", "lbx-ai-infrastructure-basket-series"], {
        body: detail,
      }),
    );
    expect(stdout).toContain("tokenized (orderable)");
    expect(stdout).toContain("unit price     $740");
    expect(stdout).toContain("min investment $15,000");
    expect(stdout).toContain("issue fee      5.00%");
    expect(stdout).toContain("admin fee      1.00% for 1y");
    expect(stdout).toContain("qualified only yes");
    expect(stdout).toContain("deadline       2026-09-23");
  });

  test("says plainly when an offer cannot be ordered via the API", async () => {
    const stdout = expectOk(
      await runCli(["opportunities", "get", "LBX-Space-Tech"], {
        body: { opportunity: offers.items[0] },
      }),
    );
    expect(stdout).toContain("(not orderable via API)");
  });

  test("requires a slug", async () => {
    const run = await runCli(["opportunities", "get"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("Missing <slug>");
    expect(run.requests).toHaveLength(0);
  });

  test("--csv is refused for a detail view before any request, with a hint", async () => {
    const run = await runCli(["opportunities", "get", "x", "--csv"], { body: detail });
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("lbx opportunities get has no tabular output; use --json");
    expect(run.requests).toHaveLength(0);
  });
});
