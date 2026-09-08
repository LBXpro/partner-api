import { readFileSync } from "node:fs";
import { getBoolean, getString, type Flags } from "./args.ts";
import { UsageError } from "./errors.ts";

export const DEFAULT_API_URL = "https://api-staging.lbxpro.tech";

export interface Config {
  apiUrl: string;
  apiKey: string;
}

export type Env = Record<string, string | undefined>;

export interface ConfigOptions {
  /** File reader for --api-key-file / LBX_KEY_FILE; injectable for tests. */
  readFile?: (path: string) => string;
}

const NO_KEY =
  "No API key. Set LBX_KEY=lbx_stg_… or LBX_KEY_FILE=<path> in the environment, " +
  "or pass --api-key-file <path>.";

/**
 * Flags beat environment beats default. The key is required for every
 * command that talks to the API — resolution is deliberately eager so the
 * failure is a usage error, not a 401 round-trip.
 *
 * Key sources, first match wins: --api-key, --api-key-file, $LBX_KEY,
 * $LBX_KEY_FILE. A file carries the key on its first line.
 */
export function resolveConfig(flags: Flags, env: Env, options: ConfigOptions = {}): Config {
  const apiUrl = getString(flags, "api") ?? env.LBX_API ?? DEFAULT_API_URL;
  const apiKey = resolveKey(flags, env, options.readFile ?? defaultReadFile);

  if (!/^https?:\/\//.test(apiUrl)) {
    throw new UsageError(`--api must be an http(s) URL, got "${apiUrl}"`);
  }
  if (apiUrl.startsWith("http://") && getBoolean(flags, "insecure") !== true) {
    throw new UsageError(
      `--api is plain http (${apiUrl}); the key would be sent unencrypted.\n` +
        "  Pass --insecure if that is intended (a local server, say).",
    );
  }

  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey };
}

function resolveKey(
  flags: Flags,
  env: Env,
  readFile: (path: string) => string,
): string {
  const flagKey = getString(flags, "apiKey");
  const flagFile = getString(flags, "apiKeyFile");
  if (flagKey !== undefined && flagFile !== undefined) {
    throw new UsageError("Pass either --api-key or --api-key-file, not both.");
  }
  if (flagKey !== undefined) {
    if (flagKey === "") throw new UsageError(NO_KEY);
    return flagKey;
  }
  if (flagFile !== undefined) return keyFromFile(flagFile, "--api-key-file", readFile);
  if (env.LBX_KEY) return env.LBX_KEY;
  if (env.LBX_KEY_FILE) return keyFromFile(env.LBX_KEY_FILE, "LBX_KEY_FILE", readFile);
  throw new UsageError(NO_KEY);
}

/** The key is the trimmed first line; anything after it is ignored. */
function keyFromFile(
  path: string,
  source: string,
  readFile: (path: string) => string,
): string {
  let text: string;
  try {
    text = readFile(path);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new UsageError(`${source}: cannot read ${path}: ${reason}`);
  }
  const first = (text.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "").trim();
  if (first === "") {
    throw new UsageError(`${source}: ${path} has no key on its first line`);
  }
  return first;
}

function defaultReadFile(path: string): string {
  return readFileSync(path, "utf8");
}

/** Never print a key in full; enough tail to tell two keys apart. */
export function maskKey(apiKey: string): string {
  if (apiKey.length <= 8) return "…";
  return `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`;
}
