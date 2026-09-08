import type { Command } from "../command.ts";
import { companyCommands } from "./companies.ts";
import { indexCommands } from "./indexes.ts";
import { miscCommands } from "./misc.ts";
import { opportunityCommands } from "./opportunities.ts";
import { orderCommands } from "./orders.ts";
import { portfolioCommands } from "./portfolio.ts";

export const commands: readonly Command[] = [
  ...miscCommands,
  ...companyCommands,
  ...indexCommands,
  ...opportunityCommands,
  ...orderCommands,
  ...portfolioCommands,
];

export interface Resolution {
  command: Command;
  /** Positionals left after the command path was consumed. */
  args: string[];
}

/**
 * Longest-prefix match, so `orders confirm-signing <id>` beats a
 * hypothetical bare `orders`.
 */
export function resolveCommand(positionals: readonly string[]): Resolution | undefined {
  let best: Resolution | undefined;

  for (const command of commands) {
    if (command.path.length > positionals.length) continue;
    const matches = command.path.every(
      (word, index) => positionals[index] === word,
    );
    if (!matches) continue;
    if (best === undefined || command.path.length > best.command.path.length) {
      best = { command, args: positionals.slice(command.path.length) };
    }
  }

  return best;
}

/** Every command under a group word, for `lbx <group>` and `lbx <group> --help`. */
export function groupCommands(group: string): Command[] {
  return commands.filter((command) => command.path[0] === group);
}

/** The distinct first words, used for help and "did you mean" hints. */
export function commandGroups(): string[] {
  const groups: string[] = [];
  for (const command of commands) {
    const group = command.path[0]!;
    if (!groups.includes(group)) groups.push(group);
  }
  return groups;
}
