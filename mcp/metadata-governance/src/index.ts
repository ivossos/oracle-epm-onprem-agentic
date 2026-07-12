import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { metadata } from "@epm/servers-as-code";

const server = new McpServer({ name: "metadata-governance", version: "0.1.0" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  "metadata_export_snapshot",
  {
    title: "Export metadata snapshot (read-only)",
    description: "Returns a metadata snapshot ('baseline' | 'current').",
    inputSchema: { which: z.string().default("current") },
  },
  async ({ which }) => ok(await metadata.exportSnapshot(which))
);

server.registerTool(
  "metadata_compare_snapshots",
  {
    title: "Compare metadata snapshots (read-only)",
    description:
      "Diffs two snapshots and returns added / removed / changed members with field-level detail.",
    inputSchema: {
      from: z.string().default("baseline"),
      to: z.string().default("current"),
    },
  },
  async ({ from, to }) => ok(await metadata.compareSnapshots({ from, to }))
);

server.registerTool(
  "metadata_find_risks",
  {
    title: "Find metadata anti-patterns (read-only)",
    description:
      "Scans a snapshot for Dynamic Calc without solve order, Stored-with-formula, and orphan members.",
    inputSchema: { which: z.string().default("current") },
  },
  async ({ which }) => ok(await metadata.findRisks(which))
);

server.registerTool(
  "metadata_member_impact_analysis",
  {
    title: "Member impact analysis (read-only)",
    description:
      "Returns descendants of a member and any member formulas that reference it.",
    inputSchema: {
      which: z.string().default("current"),
      dimension: z.string(),
      member: z.string(),
    },
  },
  async ({ which, dimension, member }) =>
    ok(await metadata.memberImpactAnalysis({ which, dimension, member }))
);

const transport = new StdioServerTransport();
await server.connect(transport);
