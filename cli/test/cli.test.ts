import { describe, expect, test } from "bun:test";
import { commandGroups, commands, resolveCommand } from "../src/commands/index.ts";
import { VERSION } from "../src/help.ts";
import { expectOk, runCli, TEST_ENV } from "./helpers.ts";

describe("resolveCommand", () => {
  test("matches a two-word command and returns the rest as args", () => {
    const resolved = resolveCommand(["companies", "get", "anthropic"])!;
    expect(resolved.command.path).toEqual(["companies", "get"]);
    expect(resolved.args).toEqual(["anthropic"]);
  });

  test("matches a one-word command", () => {
    expect(resolveCommand(["ping"])!.command.path).toEqual(["ping"]);
  });

  test("prefers the longest matching path", () => {
    const resolved = resolveCommand(["orders", "confirm-signing", "o1"])!;
    expect(resolved.command.path).toEqual(["orders", "confirm-signing"]);
    expect(resolved.args).toEqual(["o1"]);
  });

  test("returns undefined for an unknown command or a bare group", () => {
    expect(resolveCommand(["frobnicate"])).toBeUndefined();
    expect(resolveCommand(["companies"])).toBeUndefined();
  });

  test("lists the groups used in the unknown-command hint", () => {
    expect(commandGroups()).toEqual([
      "ping",
      "companies",
      "prices",
      "indexes",
      "opportunities",
      "orders",
      "portfolio",
      "positions",
    ]);
  });
});

describe("command definitions", () => {
  test("every command that renders a table is marked tabular, and only those", async () => {
    const expected = [
      "companies list", "companies charts", "companies funding", "companies prices",
      "prices",
      "indexes list", "indexes history",
      "opportunities list",
      "orders list", "orders documents",
      "portfolio show", "portfolio history", "positions history",
    ];
    const marked = commands.filter((c) => c.tabular).map((c) => c.path.join(" "));
    expect(marked.sort()).toEqual([...expected].sort());
  });

  test("--csv on a non-tabular command is a usage error before any request", async () => {
    for (const argv of [["ping"], ["orders", "get", "o1"], ["orders", "file", "o1", "d1"]]) {
      const run = await runCli([...argv, "--csv"]);
      expect(run.exitCode).toBe(64);
      expect(run.stderr).toContain("no tabular output; use --json");
      expect(run.requests).toHaveLength(0);
    }
  });

  test("every command has a summary and a usage line that starts with lbx", () => {
    for (const command of commands) {
      expect(command.summary.length).toBeGreaterThan(0);
      expect(command.usage).toStartWith(`lbx ${command.path.join(" ")}`);
    }
  });

  test("command paths are unique", () => {
    const paths = commands.map((command) => command.path.join(" "));
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("global behaviour", () => {
  test("no arguments prints the command list", async () => {
    const run = await runCli([]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("usage: lbx <command>");
    expect(run.stdout).toContain("companies list");
    expect(run.requests).toHaveLength(0);
  });

  test("--help and -h show the same overview", async () => {
    const long = await runCli(["--help"]);
    const short = await runCli(["-h"]);
    expect(long.stdout).toBe(short.stdout);
    expect(long.stdout).toContain("global flags:");
  });

  test("--help after a command shows that command's flags", async () => {
    const stdout = expectOk(await runCli(["companies", "list", "--help"]));
    expect(stdout).toContain("usage: lbx companies list");
    expect(stdout).toContain("--industry <name>");
    expect(stdout).not.toContain("orders create");
  });

  test("--help never calls the API, even without a key", async () => {
    const run = await runCli(["companies", "list", "--help"], {}, {});
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
  });

  test("--version and -V print the version", async () => {
    expect(expectOk(await runCli(["--version"]))).toBe(VERSION);
    expect(expectOk(await runCli(["-V"]))).toBe(VERSION);
  });

  test("--verbose / -v logs the exchange to stderr with the key masked", async () => {
    for (const flag of ["--verbose", "-v"]) {
      const run = await runCli(["ping", flag], {
        body: { total: 1, items: [] },
        headers: { "x-request-id": "req-7" },
      });
      expectOk(run);
      expect(run.notes[0]).toBe("> GET https://api.test/v1/partner/companies?limit=1");
      expect(run.notes[1]).toBe("> authorization: Bearer lbx_stg_…test");
      expect(run.notes.at(-1)).toMatch(/^< 200 .* \(x-request-id req-7\)$/);
      expect(run.notes.join("\n")).not.toContain("lbx_stg_test");
    }
  });

  test("without --verbose nothing is logged", async () => {
    const run = await runCli(["ping"], { body: { total: 1, items: [] } });
    expect(run.notes).toEqual([]);
  });

  test("--api-key-file reads the first line of the file", async () => {
    const run = await runCli(
      ["ping", "--api-key-file", "/keys/partner"],
      { body: { total: 1, items: [] } },
      { env: {}, deps: { readFile: () => "lbx_stg_fromfile\nnot the key\n" } },
    );
    expectOk(run);
    expect(run.stub.only().headers.authorization).toBe("Bearer lbx_stg_fromfile");
  });

  test("LBX_KEY_FILE works when LBX_KEY is unset", async () => {
    const run = await runCli(["ping"], { body: { total: 1, items: [] } }, {
      env: { LBX_API: "https://api.test", LBX_KEY_FILE: "/keys/partner" },
      deps: { readFile: () => "lbx_stg_envfile" },
    });
    expectOk(run);
    expect(run.stub.only().headers.authorization).toBe("Bearer lbx_stg_envfile");
  });

  test("an unreadable key file is a usage error before any request", async () => {
    const run = await runCli(["ping", "--api-key-file", "/nope"], {}, {
      env: {},
      deps: {
        readFile: () => {
          throw new Error("ENOENT: no such file or directory");
        },
      },
    });
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("--api-key-file: cannot read /nope: ENOENT");
    expect(run.requests).toHaveLength(0);
  });

  test("a plain-http base URL is refused unless --insecure", async () => {
    const env = { LBX_KEY: "k", LBX_API: "http://localhost:3000" };
    const refused = await runCli(["ping"], {}, { env });
    expect(refused.exitCode).toBe(64);
    expect(refused.stderr).toContain("plain http");
    expect(refused.requests).toHaveLength(0);

    const allowed = await runCli(["ping", "--insecure"], { body: { total: 1, items: [] } }, { env });
    expectOk(allowed);
    expect(allowed.stub.only().url).toStartWith("http://localhost:3000/");
  });

  test("--timeout aborts a request that never answers", async () => {
    const outcome = await (await import("../src/cli.ts")).run(["ping", "--timeout", "0.01"], {
      env: TEST_ENV,
      fetch: (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("timed out after 0.01s");
    expect(outcome.stderr).toContain("--timeout");
  });

  test("a negative --timeout is a usage error", async () => {
    const run = await runCli(["ping", "--timeout", "-1"]);
    expect(run.exitCode).toBe(64);
    expect(run.requests).toHaveLength(0);
  });

  test("an unknown command exits 64 and hints at the groups", async () => {
    const run = await runCli(["frobnicate"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("Unknown command: frobnicate");
    expect(run.stderr).toContain("known groups: ping, companies");
    expect(run.requests).toHaveLength(0);
  });

  test("a bare group lists its commands and exits 64, not a silent no-op", async () => {
    const run = await runCli(["companies"]);
    expect(run.exitCode).toBe(64);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("usage: lbx companies <command>");
    expect(run.stderr).toContain("companies list");
    expect(run.stderr).toContain("companies funding");
    expect(run.stderr).not.toContain("orders list");
    expect(run.stderr).not.toContain("Unknown command");
    expect(run.requests).toHaveLength(0);
  });

  test("<group> --help prints the same listing on stdout and exits 0", async () => {
    const run = await runCli(["orders", "--help"], {}, {});
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("usage: lbx orders <command>");
    expect(run.stdout).toContain("orders confirm-signing");
    expect(run.stdout).toContain("lbx orders <command> --help");
    expect(run.requests).toHaveLength(0);
  });

  test("an unknown word with extra arguments is still an unknown command", async () => {
    const run = await runCli(["companies", "frobnicate"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("Unknown command: companies frobnicate");
  });

  test("a missing key fails before any request is made", async () => {
    const run = await runCli(["ping"], {}, {});
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("No API key");
    expect(run.requests).toHaveLength(0);
  });

  test("--api-key overrides the environment", async () => {
    const run = await runCli(["ping", "--api-key", "lbx_stg_other"], {
      body: { total: 1 },
    });
    expectOk(run);
    expect(run.stub.only().headers.authorization).toBe("Bearer lbx_stg_other");
  });

  test("the key never appears in output", async () => {
    const run = await runCli(["ping"], { body: { total: 1 } });
    expect(run.stdout).not.toContain(TEST_ENV.LBX_KEY);
    expect(run.stderr).not.toContain(TEST_ENV.LBX_KEY);
  });

  test("--format picks the renderer explicitly", async () => {
    const body = { items: [], total: 0 };
    expect(expectOk(await runCli(["companies", "list", "--format", "json"], { body }))).toBe(
      JSON.stringify(body, null, 2),
    );
    expect(expectOk(await runCli(["companies", "list", "--format=csv"], { body }))).toStartWith(
      "SLUG,NAME",
    );
  });

  test("an unknown --format is rejected before the call", async () => {
    const run = await runCli(["companies", "list", "--format", "xml"]);
    expect(run.exitCode).toBe(64);
    expect(run.stderr).toContain("--format must be table, json or csv");
    expect(run.requests).toHaveLength(0);
  });

  test("-j is shorthand for --json", async () => {
    const body = { items: [], total: 0 };
    expect(expectOk(await runCli(["companies", "list", "-j"], { body }))).toBe(
      JSON.stringify(body, null, 2),
    );
  });

  test("sends a versioned user agent", async () => {
    const run = await runCli(["ping"], { body: { total: 1 } });
    expect(run.stub.only().headers["user-agent"]).toBe(`lbx-partner-cli/${VERSION}`);
  });

  test("a transport failure is reported without a stack trace", async () => {
    const outcome = await (await import("../src/cli.ts")).run(["ping"], {
      env: TEST_ENV,
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("failed: ECONNREFUSED");
    expect(outcome.stderr).not.toContain("at ");
  });

  test("a non-JSON 200 (a login wall, say) is explained", async () => {
    const run = await runCli(["ping"], { status: 200, text: "<html>login</html>" });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("Expected JSON");
  });
});
