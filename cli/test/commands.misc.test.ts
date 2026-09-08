import { describe, expect, test } from "bun:test";
import { expectOk, runCli } from "./helpers.ts";

describe("ping", () => {
  test("makes the cheapest authenticated call there is", async () => {
    const run = await runCli(["ping"], { body: { total: 967, items: [] } });
    expectOk(run);
    const request = run.stub.only();
    expect(request.path).toBe("/v1/partner/companies");
    expect(request.query.limit).toEqual(["1"]);
  });

  test("reports the base URL it reached and what it can see", async () => {
    const stdout = expectOk(await runCli(["ping"], { body: { total: 967, items: [] } }));
    expect(stdout).toContain("ok  https://api.test");
    expect(stdout).toContain("companies visible: 967");
  });

  test("honours --api", async () => {
    const run = await runCli(["ping", "--api", "https://other.test/"], {
      body: { total: 1, items: [] },
    });
    const stdout = expectOk(run);
    expect(run.stub.only().url).toStartWith("https://other.test/v1/partner/companies");
    expect(stdout).toContain("ok  https://other.test");
  });

  test("--json is machine-readable", async () => {
    const stdout = expectOk(await runCli(["ping", "--json"], { body: { total: 5, items: [] } }));
    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      apiUrl: "https://api.test",
      key: "lbx_stg_…test",
      companies: 5,
    });
  });

  test("shows which key it used, masked", async () => {
    const stdout = expectOk(await runCli(["ping"], { body: { total: 1, items: [] } }));
    expect(stdout).toContain("key lbx_stg_…test");
    expect(stdout).not.toContain("lbx_stg_test");
  });

  test("a bad key exits 2, distinct from other failures", async () => {
    const run = await runCli(["ping"], {
      status: 401,
      body: { error: "Invalid partner API key", code: "UNAUTHORIZED" },
    });
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("UNAUTHORIZED (HTTP 401)");
  });

  test("an ineligible account exits 3, distinct from a bad key", async () => {
    for (const code of ["FORBIDDEN", "INVESTOR_SETUP_INCOMPLETE"]) {
      const run = await runCli(["ping"], { status: 403, body: { error: "no", code } });
      expect(run.exitCode).toBe(3);
      expect(run.stderr).toContain(`${code} (HTTP 403)`);
    }
  });

  test("an unprovisioned account 404s on every partner route", async () => {
    const run = await runCli(["ping"], {
      status: 404,
      body: { error: "Not found", code: "NOT_FOUND" },
    });
    expect(run.exitCode).toBe(1);
  });
});
