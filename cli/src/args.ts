import { UsageError } from "./errors.ts";

export type FlagValue = string | boolean | string[];
export type Flags = Record<string, FlagValue>;

export interface ParsedArgs {
  /** Positional arguments, in order, with flags removed. */
  positionals: string[];
  flags: Flags;
}

const FLAG = /^--([^=]*)(?:=([\s\S]*))?$/;

/**
 * Flags that never take a free-form value. Declaring them keeps
 * `lbx --help companies` from reading "companies" as the value of --help,
 * while `--in-lbx25 false` still works because an explicit boolean literal
 * is still consumed.
 */
export const BOOLEAN_FLAGS: readonly string[] = [
  "help",
  "version",
  "json",
  "csv",
  "verbose",
  "insecure",
  "inLbx25",
  "lots",
];

const BOOLEAN_LITERALS = new Set(["true", "false", "yes", "no", "1", "0"]);

/**
 * Minimal GNU-ish parser: `--flag`, `--flag value`, `--flag=value`,
 * `--no-flag`, and `--` to stop parsing. A flag repeated becomes an array,
 * which is how the API's repeatable filters (e.g. industry) are expressed.
 *
 * A bare `--flag` is boolean true; the next token is only consumed as its
 * value when it does not itself look like a flag. `--flag=` yields "".
 */
export function parseArgs(
  argv: readonly string[],
  options: { booleans?: readonly string[] } = {},
): ParsedArgs {
  const booleans = new Set(
    (options.booleans ?? BOOLEAN_FLAGS).map((name) => camelCase(name)),
  );
  const positionals: string[] = [];
  const flags: Flags = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    const match = FLAG.exec(token);
    if (!match) {
      positionals.push(token);
      continue;
    }

    const rawName = match[1]!;
    if (rawName === "") throw new UsageError(`Malformed flag: ${token}`);

    const inlineValue = match[2];
    let name = camelCase(rawName);
    let value: FlagValue;

    if (inlineValue !== undefined) {
      value = inlineValue;
    } else if (rawName.startsWith("no-")) {
      name = camelCase(rawName.slice(3));
      value = false;
    } else {
      const next = argv[i + 1];
      const consumable =
        next !== undefined &&
        !isFlagLike(next) &&
        (!booleans.has(name) || BOOLEAN_LITERALS.has(next.toLowerCase()));
      if (consumable) {
        value = next!;
        i++;
      } else {
        value = true;
      }
    }

    const existing = flags[name];
    if (existing === undefined) {
      flags[name] = value;
    } else {
      // Repeats collect into an array; booleans have no value to collect.
      const asList = Array.isArray(existing) ? existing : [String(existing)];
      flags[name] = [...asList, String(value)];
    }
  }

  return { positionals, flags };
}

/** `--` followed by anything that is not a negative number. */
function isFlagLike(token: string): boolean {
  if (!token.startsWith("--")) return false;
  return !/^--?\d/.test(token);
}

export function camelCase(name: string): string {
  return name.replace(/-([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
}

/* ---- typed accessors -------------------------------------------------- */

export function getString(
  flags: Flags,
  name: string,
): string | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    throw new UsageError(`--${kebab(name)} was given more than once`);
  }
  if (typeof value === "boolean") {
    throw new UsageError(`--${kebab(name)} needs a value`);
  }
  return value;
}

export function getList(flags: Flags, name: string): string[] | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === "boolean") {
    throw new UsageError(`--${kebab(name)} needs a value`);
  }
  return [value];
}

export function getNumber(flags: Flags, name: string): number | undefined {
  const raw = getString(flags, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(parsed)) {
    throw new UsageError(`--${kebab(name)} must be a number, got "${raw}"`);
  }
  return parsed;
}

export function getInteger(flags: Flags, name: string): number | undefined {
  const parsed = getNumber(flags, name);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed)) {
    throw new UsageError(`--${kebab(name)} must be a whole number, got "${parsed}"`);
  }
  return parsed;
}

export function getBoolean(flags: Flags, name: string): boolean | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    throw new UsageError(`--${kebab(name)} was given more than once`);
  }
  const normalized = value.toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  throw new UsageError(`--${kebab(name)} must be true or false, got "${value}"`);
}

export function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
