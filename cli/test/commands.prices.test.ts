import { describe, expect, test } from "bun:test";
import { expectOk, runCli } from "./helpers.ts";

const day = {
  date: "2026-09-08",
  items: [
    { slug: "anthropic", company: "Anthropic", institutionalPrice: 871, retailPrice: 970 },
    { slug: "openai", company: "OpenAI", institutionalPrice: 519, retailPrice: null },
  ],
};

describe("prices", () => {
  test("pulls the latest day when no --date is given", async () => {
    const run = await runCli(["prices"], { body: day });
    expectOk(run);
    const request = run.stub.only();
    expect(request.path).toBe("/v1/partner/daily-prices");
    expect(request.query).toEqual({});
  });

  test("passes --date through", async () => {
    const run = await runCli(["prices", "--date", "2026-09-04"], { body: { ...day, date: "2026-09-04" } });
    expectOk(run);
    expect(run.stub.only().query).toEqual({ date: ["2026-09-04"] });
  });

  test("tabulates every company with the day in the title", async () => {
    const stdout = expectOk(await runCli(["prices"], { body: day }));
    expect(stdout).toContain("daily prices — 2026-09-08");
    const openai = stdout.split("\n").find((l) => l.startsWith("openai"))!;
    expect(openai).toContain("OpenAI");
    expect(openai).toContain("$519");
    expect(openai).toContain("—");
    expect(stdout).toContain("2 companies");
  });

  test("says so when nothing has been published", async () => {
    const stdout = expectOk(await runCli(["prices"], { body: { date: null, items: [] } }));
    expect(stdout).toContain("no daily prices published yet");
  });

  test("a day with no rows is not an error", async () => {
    const stdout = expectOk(await runCli(["prices", "--date", "2026-01-01"], { body: { date: "2026-01-01", items: [] } }));
    expect(stdout).toContain("no prices on 2026-01-01");
  });

  test("rejects a malformed --date locally", async () => {
    const run = await runCli(["prices", "--date", "today"], { body: day });
    expect(run.exitCode).toBe(64);
    expect(run.requests).toHaveLength(0);
  });

  test("--json returns the body untouched", async () => {
    const stdout = expectOk(await runCli(["prices", "--json"], { body: day }));
    expect(JSON.parse(stdout)).toEqual(day);
  });
});
