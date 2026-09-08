import type { Command } from "./command.ts";
import { commands, groupCommands } from "./commands/index.ts";
import { DEFAULT_API_URL } from "./config.ts";

export const VERSION = "0.1.0";

const GLOBAL_OPTIONS: [string, string][] = [
  ["--api-key-file <path>", "File whose first line is the partner key (default: $LBX_KEY_FILE)"],
  ["--api-key <key>", "Partner key inline — lands in shell history, prefer the env or file"],
  ["--api <url>", `Base URL (default: $LBX_API, else ${DEFAULT_API_URL})`],
  ["--insecure", "Allow a plain-http --api (the key travels unencrypted)"],
  ["--timeout <seconds>", "Per-request budget (default 30; 0 disables)"],
  ["--json, -j", "Print the raw API response"],
  ["--csv", "Print the table as CSV"],
  ["--verbose, -v", "Log each request and response to stderr (key masked)"],
  ["--help, -h", "Show help"],
  ["--version, -V", "Show version"],
];

export function globalHelp(): string {
  const lines = [
    "lbx — command-line client for the LBX Partner API",
    "",
    "usage: lbx <command> [args] [flags]",
    "",
    "commands:",
  ];

  const width = Math.max(...commands.map((c) => c.path.join(" ").length));
  let previousGroup: string | undefined;
  for (const command of commands) {
    const group = command.path[0]!;
    if (previousGroup !== undefined && group !== previousGroup) lines.push("");
    previousGroup = group;
    lines.push(`  ${command.path.join(" ").padEnd(width)}  ${command.summary}`);
  }

  lines.push("", "global flags:", ...optionLines(GLOBAL_OPTIONS));
  lines.push(
    "",
    "environment:",
    "  LBX_KEY        partner API key (lbx_stg_…)",
    "  LBX_KEY_FILE   path to a file whose first line is the key",
    "  LBX_API        base URL override",
    "",
    "Run `lbx <command> --help` for command detail.",
  );
  return lines.join("\n");
}

export function groupHelp(group: string): string {
  const members = groupCommands(group);
  const width = Math.max(...members.map((c) => c.path.join(" ").length));
  return [
    `usage: lbx ${group} <command> [args] [flags]`,
    "",
    "commands:",
    ...members.map((c) => `  ${c.path.join(" ").padEnd(width)}  ${c.summary}`),
    "",
    `Run \`lbx ${group} <command> --help\` for that command's flags.`,
  ].join("\n");
}

export function commandHelp(command: Command): string {
  const lines = [command.summary, "", `usage: ${command.usage}`];
  if (command.options && command.options.length > 0) {
    lines.push("", "flags:", ...optionLines(command.options));
  }
  lines.push("", "global flags:", ...optionLines(GLOBAL_OPTIONS));
  return lines.join("\n");
}

function optionLines(options: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...options.map(([flag]) => flag.length));
  return options.map(([flag, description]) => `  ${flag.padEnd(width)}  ${description}`);
}
