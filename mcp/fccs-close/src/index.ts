import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fccs } from "@epm/servers-as-code";

const server = new McpServer({ name: "fccs-close", version: "0.1.0" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  "fccs_close_readiness_report",
  {
    title: "Close readiness report (read-only)",
    description:
      "Aggregates metadata validation, journal state, and intercompany matching into a go/no-go close readiness report. Read-only; run this first.",
    inputSchema: {
      app: z.string(),
      period: z.string().optional(),
    },
  },
  async ({ app, period }) => ok(await fccs.closeReadinessReport({ app, period }))
);

server.registerTool(
  "fccs_validate_metadata",
  {
    title: "Validate FCCS metadata",
    description: "Runs FCCS metadata validation and returns errors/warnings (read-only).",
    inputSchema: { app: z.string() },
  },
  async ({ app }) => ok(await fccs.validateMetadata(app))
);

server.registerTool(
  "fccs_retrieve_journals",
  {
    title: "Retrieve journals",
    description: "Retrieves journals with optional filter (read-only).",
    inputSchema: {
      period: z.string().optional(),
      status: z.string().optional(),
      entity: z.string().optional(),
    },
  },
  async (filter) => ok(await fccs.retrieveJournals(filter as never))
);

server.registerTool(
  "fccs_intercompany_matching_report",
  {
    title: "Intercompany matching report",
    description: "Returns intercompany matches and mismatches (read-only).",
    inputSchema: {},
  },
  async () => ok(await fccs.intercompanyMatchingReport())
);

const transport = new StdioServerTransport();
await server.connect(transport);
