import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { hfm } from "@epm/servers-as-code";

const server = new McpServer({ name: "hfm", version: "0.1.0" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  "hfm_consolidation_health_check",
  {
    title: "Consolidation health check (read-only)",
    description:
      "Aggregates entity consolidation status, balancing, IC transactions, and data quality into a single readiness report. Run this first for a quick overview.",
    inputSchema: {
      app: z.string(),
      period: z.string(),
    },
  },
  async ({ app, period }) => ok(await hfm.consolidationHealthCheck({ app, period }))
);

server.registerTool(
  "hfm_list_entities",
  {
    title: "List HFM entities",
    description: "Retrieves the entity hierarchy (parents and children) (read-only).",
    inputSchema: { app: z.string() },
  },
  async ({ app }) => ok(await hfm.listHfmEntities(app))
);

server.registerTool(
  "hfm_consolidation_status",
  {
    title: "Consolidation status",
    description:
      "Shows consolidation progress for each entity by period/scenario (read-only).",
    inputSchema: {
      app: z.string(),
      period: z.string().optional(),
      scenario: z.string().optional(),
    },
  },
  async ({ app, period, scenario }) =>
    ok(await hfm.getConsolidationStatus(app, { period, scenario }))
);

server.registerTool(
  "hfm_balancing_status",
  {
    title: "Balancing status",
    description:
      "Shows debit/credit balance for each entity and detects imbalances (read-only).",
    inputSchema: {
      app: z.string(),
      entity: z.string().optional(),
      period: z.string().optional(),
    },
  },
  async ({ app, entity, period }) =>
    ok(await hfm.getBalancingStatus(app, { entity, period }))
);

server.registerTool(
  "hfm_intercompany_transactions",
  {
    title: "Intercompany transactions",
    description: "Lists inter-company transactions and their match status (read-only).",
    inputSchema: {
      app: z.string(),
      status: z.enum(["Pending", "Matched", "Rejected", "Confirmed"]).optional(),
    },
  },
  async ({ app, status }) =>
    ok(await hfm.listIntercompanyTransactions(app, { status }))
);

server.registerTool(
  "hfm_consolidation_report",
  {
    title: "Consolidation report",
    description:
      "Aggregated monthly consolidation report: entity counts, completion status, and open issues (read-only).",
    inputSchema: {
      app: z.string(),
      period: z.string(),
    },
  },
  async ({ app, period }) => ok(await hfm.getConsolidationReport(app, period))
);

server.registerTool(
  "hfm_currency_conversions",
  {
    title: "Currency conversion rates",
    description: "Lists active currency conversion rates and their effective dates (read-only).",
    inputSchema: { app: z.string() },
  },
  async ({ app }) => ok(await hfm.listCurrencyConversions(app))
);

server.registerTool(
  "hfm_list_extracts",
  {
    title: "List HFM extracts",
    description:
      "Lists available data extract definitions (dimensions, format, schedule) (read-only).",
    inputSchema: { app: z.string() },
  },
  async ({ app }) => ok(await hfm.listHfmExtracts(app))
);

const transport = new StdioServerTransport();
await server.connect(transport);
