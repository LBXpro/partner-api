import type { Flags } from "./args.ts";
import type { PartnerClient } from "./client.ts";
import type { CommandResult } from "./output.ts";

export interface RunContext {
  client: PartnerClient;
  /** Positionals left over after the command name was matched. */
  args: string[];
  flags: Flags;
  /** Writes a line to stderr immediately — for progress the user must see before a request returns. */
  stderr: (line: string) => void;
  /** Injectable so polling commands are testable without waiting. */
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface Command {
  /** Command words, e.g. ["companies", "list"]. */
  path: readonly string[];
  summary: string;
  usage: string;
  /** [flag, description] pairs, shown by `--help` on the command. */
  options?: readonly (readonly [string, string])[];
  /** True when the result carries a table, i.e. --csv is meaningful. */
  tabular?: boolean;
  run(context: RunContext): Promise<CommandResult<any>>;
}

export const commandName = (command: Command): string => command.path.join(" ");
