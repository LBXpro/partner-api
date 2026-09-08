import { getBoolean, getNumber, getString, parseArgs } from "./args.ts";
import { DEFAULT_TIMEOUT_MS, PartnerClient, type FetchLike } from "./client.ts";
import { resolveConfig, type Env } from "./config.ts";
import { commandGroups, groupCommands, resolveCommand } from "./commands/index.ts";
import { CliError, UsageError } from "./errors.ts";
import { commandHelp, globalHelp, groupHelp, VERSION } from "./help.ts";
import { render, type OutputFormat } from "./output.ts";

export interface RunDeps {
  env: Env;
  fetch?: FetchLike;
  /**
   * Eager stderr sink for lines that must be visible before a request
   * completes (progress, the idempotency key). Errors still come back in
   * the outcome so the caller decides how to print them.
   */
  stderr?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  readFile?: (path: string) => string;
}

export interface RunOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Raw bytes for stdout in place of `stdout`, when a command streams a file. */
  stdoutBytes?: Uint8Array;
}

const SHORT_FLAGS: Record<string, string> = {
  "-h": "--help",
  "-V": "--version",
  "-v": "--verbose",
  "-j": "--json",
};

/**
 * Parse, dispatch, render. Returns the streams rather than writing them so
 * the whole CLI is testable without touching the process.
 */
export async function run(
  argv: readonly string[],
  deps: RunDeps,
): Promise<RunOutcome> {
  const stderr = deps.stderr ?? (() => {});
  try {
    const expanded = argv.map((token) => SHORT_FLAGS[token] ?? token);
    const { positionals, flags } = parseArgs(expanded);

    if (getBoolean(flags, "version") === true) {
      return ok(VERSION);
    }

    const wantsHelp = getBoolean(flags, "help") === true;
    if (positionals.length === 0) {
      return ok(globalHelp());
    }

    const resolved = resolveCommand(positionals);
    if (!resolved) {
      const group = positionals[0]!;
      if (positionals.length === 1 && groupCommands(group).length > 0) {
        // A bare group is still a usage error, but the useful answer is
        // its commands, not "unknown command".
        if (wantsHelp) return ok(groupHelp(group));
        throw new UsageError(groupHelp(group));
      }
      throw new UsageError(
        `Unknown command: ${positionals.join(" ")}\n` +
          `  known groups: ${commandGroups().join(", ")}\n` +
          "  run `lbx --help` for the full list",
      );
    }
    if (wantsHelp) return ok(commandHelp(resolved.command));

    const format = resolveFormat(flags);
    if (format === "csv" && resolved.command.tabular !== true) {
      throw new UsageError(
        `lbx ${resolved.command.path.join(" ")} has no tabular output; use --json.`,
      );
    }

    const config = resolveConfig(flags, deps.env, {
      ...(deps.readFile ? { readFile: deps.readFile } : {}),
    });
    const verbose = getBoolean(flags, "verbose") === true;
    const client = new PartnerClient(config, {
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(verbose ? { log: stderr } : {}),
      userAgent: `lbx-partner-cli/${VERSION}`,
      timeoutMs: resolveTimeoutMs(flags),
    });

    const result = await resolved.command.run({
      client,
      args: resolved.args,
      flags,
      stderr,
      sleep: deps.sleep ?? defaultSleep,
      now: deps.now ?? Date.now,
    });

    if (result.bytes) {
      return { exitCode: 0, stdout: "", stderr: "", stdoutBytes: result.bytes };
    }
    return ok(render(result, format));
  } catch (error) {
    return fail(error);
  }
}

function resolveFormat(flags: Record<string, unknown>): OutputFormat {
  const explicit = getString(flags as never, "format");
  if (explicit !== undefined) {
    if (explicit !== "table" && explicit !== "json" && explicit !== "csv") {
      throw new UsageError(`--format must be table, json or csv, got "${explicit}"`);
    }
    return explicit;
  }
  if (getBoolean(flags as never, "json") === true) return "json";
  if (getBoolean(flags as never, "csv") === true) return "csv";
  return "table";
}

/** `--timeout <seconds>`; 0 disables. */
function resolveTimeoutMs(flags: Record<string, unknown>): number {
  const seconds = getNumber(flags as never, "timeout");
  if (seconds === undefined) return DEFAULT_TIMEOUT_MS;
  if (seconds < 0) throw new UsageError("--timeout must be 0 or more seconds");
  return Math.round(seconds * 1000);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ok(stdout: string): RunOutcome {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(error: unknown): RunOutcome {
  if (error instanceof CliError) {
    return { exitCode: error.exitCode, stdout: "", stderr: error.describe() };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { exitCode: 1, stdout: "", stderr: message };
}
