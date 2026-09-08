import type { Command } from "../command.ts";
import type { CommandResult } from "../output.ts";

/**
 * Cheapest authenticated call there is — confirms the key is provisioned on
 * this environment without pulling a page of data.
 */
const ping: Command = {
  path: ["ping"],
  summary: "Check that the base URL and key work",
  usage: "lbx ping",
  async run({ client }): Promise<CommandResult> {
    const data = await client.get<{ total?: number | null }>(
      "/v1/partner/companies",
      { limit: 1 },
    );
    return {
      data: {
        ok: true,
        apiUrl: client.apiUrl,
        key: client.maskedKey,
        companies: data.total ?? null,
      },
      lines: [
        `ok  ${client.apiUrl}`,
        `key ${client.maskedKey}`,
        `companies visible: ${data.total ?? "unknown"}`,
      ],
    };
  },
};

export const miscCommands: Command[] = [ping];
