import { UsageError } from "../errors.ts";

/** Pull a required positional, failing with the command's own usage line. */
export function requireArg(
  args: readonly string[],
  index: number,
  name: string,
  usage: string,
): string {
  const value = args[index];
  if (value === undefined || value === "") {
    throw new UsageError(`Missing <${name}>.\n  usage: ${usage}`);
  }
  return value;
}
