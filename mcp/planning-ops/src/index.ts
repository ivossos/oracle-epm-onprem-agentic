import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { planning } from "@epm/servers-as-code";

const server = new McpServer({ name: "planning-ops", version: "0.1.0" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  "planning_export_data_slice",
  {
    title: "Export Planning data slice",
    description:
      "Exports a data slice and returns a bounded envelope (counts + sample + artifact path).",
    inputSchema: {
      app: z.string(),
      cube: z.string(),
    },
  },
  async ({ app, cube }) => ok(await planning.exportDataSlice({ app, cube }))
);

server.registerTool(
  "planning_variance_snapshot",
  {
    title: "Actual vs Forecast variance snapshot",
    description:
      "Computes actual-vs-forecast variances and returns exceptions (missing data or |variance%| over threshold).",
    inputSchema: {
      app: z.string(),
      cube: z.string(),
      thresholdPct: z.number().optional().describe("e.g. 0.05 for 5%"),
    },
  },
  async ({ app, cube, thresholdPct }) =>
    ok(await planning.varianceSnapshot({ app, cube, thresholdPct }))
);

server.registerTool(
  "planning_get_substitution_variables",
  {
    title: "Get substitution variables",
    description: "Lists substitution variables for the application (read-only).",
    inputSchema: { app: z.string() },
  },
  async ({ app }) => ok(await planning.getSubstitutionVariables(app))
);

const transport = new StdioServerTransport();
await server.connect(transport);
