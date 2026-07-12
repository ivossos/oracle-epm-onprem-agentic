import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { automate } from "@epm/servers-as-code";
import { writeGuard, type ApprovalPacket } from "@epm/claude-agent/src/policies/write-guard.js";

const server = new McpServer({ name: "epm-automate-wrapper", version: "0.1.0" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function blocked(reason: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ blocked: true, reason }, null, 2) }],
    isError: true,
  };
}

server.registerTool(
  "automate_list_commands",
  {
    title: "List allowlisted EPM Automate commands (read-only)",
    description:
      "Returns the typed allowlist of EPM Automate commands. No arbitrary shell is ever exposed.",
    inputSchema: {},
  },
  async () => ok(await automate.listCommands())
);

server.registerTool(
  "automate_runbook_status",
  {
    title: "Runbook status (read-only)",
    description: "Returns EPM Automate runbooks and their last run/status.",
    inputSchema: {},
  },
  async () => ok(await automate.runbookStatus())
);

server.registerTool(
  "automate_run_approved_command",
  {
    title: "Run allowlisted EPM Automate command",
    description:
      "Runs an ALLOWLISTED EPM Automate command with typed params. Read-only commands run directly; mutating commands require a user-confirmed approval packet.",
    inputSchema: {
      command: z.string().describe("Must be on the allowlist (see automate_list_commands)"),
      params: z.record(z.string()).optional(),
      approvalPacket: z.custom<ApprovalPacket>().optional(),
      actor: z.string().default("agent"),
    },
  },
  async ({ command, params, approvalPacket, actor }) => {
    // Gate mutating commands through the shared write-guard. The tool name
    // 'automate_run' is on the mutating list, so the guard enforces a packet.
    const guard = writeGuard("automate_run", approvalPacket);
    // Read-only commands (e.g. downloadSnapshot, listFiles) bypass the packet
    // requirement: the client itself only demands a packet for mutating specs.
    try {
      const result = await automate.runApprovedCommand({
        command,
        params,
        approvalPacketId: approvalPacket?.id,
        actor,
      });
      return ok(result);
    } catch (err) {
      // If the client refused (mutating without packet), surface the guard reason.
      const msg = err instanceof Error ? err.message : String(err);
      if (/requires approvalPacketId/.test(msg) && !guard.allowed) {
        return blocked(guard.reason ?? msg);
      }
      return blocked(msg);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
