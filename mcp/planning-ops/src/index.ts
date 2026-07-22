import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { planning, dimensions } from "@epm/servers-as-code";
import { writeGuard, type ApprovalPacket } from "@epm/claude-agent/src/policies/write-guard.js";

const server = new McpServer({ name: "planning-ops", version: "0.1.0" });

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
  "planning_export_data_slice",
  {
    title: "Export Planning data slice",
    description:
      "Exports a data slice and returns a bounded envelope (counts + sample + artifact path).",
    inputSchema: {
      app: z.string(),
      cube: z.string(),
      mdx: z
        .string()
        .optional()
        .describe("On-prem: pass-through Essbase MDX query. Defaults to the demo slice."),
    },
  },
  async ({ app, cube, mdx }) => ok(await planning.exportDataSlice({ app, cube, mdx }))
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
      mdx: z
        .string()
        .optional()
        .describe("On-prem: pass-through Essbase MDX query (place Scenario on an axis)."),
      scenarioDim: z
        .string()
        .optional()
        .describe("Scenario dimension key. Auto-detected (Scenario/Cenario) when omitted."),
      actualMember: z
        .string()
        .optional()
        .describe("Scenario member treated as actual. Default 'Actual'."),
      baselineMember: z
        .string()
        .optional()
        .describe("Baseline scenario to compare against. Default 'Forecast'; use 'Plan' for budget variance."),
    },
  },
  async ({ app, cube, thresholdPct, mdx, scenarioDim, actualMember, baselineMember }) =>
    ok(await planning.varianceSnapshot({ app, cube, thresholdPct, mdx, scenarioDim, actualMember, baselineMember }))
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

server.registerTool(
  "planning_list_dimensions",
  {
    title: "List dimensions",
    description:
      "Lists the dimensions in the local member database and their member counts (read-only).",
    inputSchema: {},
  },
  async () => ok(dimensions.listDimensions())
);

server.registerTool(
  "planning_find_members",
  {
    title: "Find members",
    description:
      "Searches the local dimension database for members by name, alias, or description " +
      "(case-insensitive substring). Use this to resolve real member names before composing an MDX query.",
    inputSchema: {
      query: z.string().describe("Substring to match against member name, alias, or description."),
      dimension: z
        .string()
        .optional()
        .describe("Restrict to one dimension, e.g. Account, Entity, Scenario."),
      limit: z.number().optional().describe("Max results (default 25, capped at 200)."),
    },
  },
  async ({ query, dimension, limit }) => ok(dimensions.findMembers({ query, dimension, limit }))
);

server.registerTool(
  "planning_get_member",
  {
    title: "Get member detail",
    description:
      "Returns one member's full exported properties, its parent, and its immediate children (read-only).",
    inputSchema: {
      dimension: z.string(),
      member: z.string(),
    },
  },
  async ({ dimension, member }) => ok(dimensions.getMember({ dimension, member }))
);

server.registerTool(
  "planning_build_mdx",
  {
    title: "Build MDX from members",
    description:
      "Composes an Essbase MDX grid query from resolved member names (columns + rows axes, " +
      "plus optional POV members fixed in WHERE). Feed the result to planning_export_data_slice. " +
      "Resolve member names first with planning_find_members.",
    inputSchema: {
      columns: z.array(z.string()).describe("Members for the COLUMNS axis, e.g. Account members."),
      rows: z.array(z.string()).describe("Members for the ROWS axis, e.g. Division members."),
      pov: z
        .array(z.string())
        .optional()
        .describe("POV members fixed in WHERE, e.g. FY25, Actual, USD."),
    },
  },
  async ({ columns, rows, pov }) => ok({ mdx: planning.buildMdx({ columns, rows, pov }) })
);

server.registerTool(
  "planning_list_business_rules",
  {
    title: "List business rules",
    description:
      "Lists the cube's business rules (Calc Manager rules / Essbase calc scripts). " +
      "Optional case-insensitive name filter (e.g. 'FY24', 'EXP2PL'); bounded result with total/matched counts.",
    inputSchema: {
      app: z.string(),
      cube: z.string(),
      filter: z.string().optional().describe("Case-insensitive substring of the rule name."),
      limit: z.number().optional().describe("Max rules to return (default 50, cap 500)."),
    },
  },
  async ({ app, cube, filter, limit }) =>
    ok(await planning.listBusinessRules({ app, cube, filter, limit }))
);

server.registerTool(
  "planning_get_business_rule",
  {
    title: "Get business rule content",
    description:
      "Returns one business rule's calc-script content (read-only). Get the name from planning_list_business_rules.",
    inputSchema: {
      app: z.string(),
      cube: z.string(),
      name: z.string(),
    },
  },
  async ({ app, cube, name }) => ok(await planning.getBusinessRule({ app, cube, name }))
);

server.registerTool(
  "planning_run_business_rule",
  {
    title: "Run business rule (MUTATING)",
    description:
      "Executes a business rule (Calc Manager rule / Essbase calc script) via the Essbase REST v1 " +
      "calc-job API. MUTATING: requires a user-confirmed approval packet with complete data scope " +
      "(environment, application, cube, scenario, version, period, entity). Get the rule name from " +
      "planning_list_business_rules and inspect it first with planning_get_business_rule.",
    inputSchema: {
      app: z.string(),
      cube: z.string(),
      name: z
        .string()
        .describe("Business rule / calc-script name (from planning_list_business_rules)."),
      parameters: z
        .record(z.string())
        .optional()
        .describe("Optional runtime-prompt / substitution-variable overrides passed to the calc."),
      approvalPacket: z.custom<ApprovalPacket>().optional(),
      actor: z.string().default("agent"),
    },
  },
  async ({ app, cube, name, parameters, approvalPacket, actor }) => {
    const guard = writeGuard("planning_run_business_rule", approvalPacket);
    if (!guard.allowed) return blocked(guard.reason ?? "blocked");
    const result = await planning.runBusinessRule({
      app,
      cube,
      ruleName: name,
      approvalPacketId: approvalPacket!.id,
      actor,
      parameters,
    });
    return ok(result);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
