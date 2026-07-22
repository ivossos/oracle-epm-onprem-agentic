import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { dataIntegration } from "@epm/servers-as-code";

const server = new McpServer({
  name: "data-integration-watchtower",
  version: "0.1.0",
});

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  "di_schedule_inventory",
  {
    title: "Pipeline / schedule inventory (read-only)",
    description:
      "Lists Data Integration pipelines with their schedules, enabled state, and integration names. Addresses weak scheduled-load visibility.",
    inputSchema: {},
  },
  async () => ok(await dataIntegration.scheduleInventory())
);

server.registerTool(
  "di_list_pipelines",
  {
    title: "List pipelines (read-only)",
    description: "Lists Data Integration pipelines.",
    inputSchema: {},
  },
  async () => ok(await dataIntegration.listPipelines())
);

server.registerTool(
  "di_get_job_status",
  {
    title: "Integration job status (read-only)",
    description: "Returns recent integration job runs with row counts and status.",
    inputSchema: {},
  },
  async () => ok(await dataIntegration.getJobStatus())
);

server.registerTool(
  "di_failed_load_summary",
  {
    title: "Failed load summary (read-only)",
    description:
      "Summarizes failed / partial loads and clusters rejection reasons for triage.",
    inputSchema: {},
  },
  async () => ok(await dataIntegration.failedLoadSummary())
);

server.registerTool(
  "di_diagnose_failures",
  {
    title: "Diagnose load failures (read-only)",
    description:
      "Correlates failed loads to POV-lock blockers and returns a triage bundle.",
    inputSchema: {},
  },
  async () => ok(await dataIntegration.diagnoseFailures())
);

server.registerTool(
  "di_export_mapping",
  {
    title: "Export mapping (read-only)",
    description: "Exports mapping rules for an integration.",
    inputSchema: { integrationId: z.string() },
  },
  async ({ integrationId }) => ok(await dataIntegration.exportMapping(integrationId))
);

server.registerTool(
  "di_pov_lock_status",
  {
    title: "POV lock status (read-only)",
    description: "Returns POV lock state per target.",
    inputSchema: {},
  },
  async () => ok(await dataIntegration.povLockStatus())
);

server.registerTool(
  "di_integration_inventory",
  {
    title: "Integration inventory — apps & rules (read-only)",
    description:
      "Lists FDMEE / Data Management registered target applications and data load rules " +
      "(with each rule's last job status). On-prem this scans location ids up to " +
      "EPM_AIF_MAX_LOCATION_ID; the returned scannedThroughLocationId shows the scan bound.",
    inputSchema: {},
  },
  async () => ok(await dataIntegration.integrationInventory())
);

const transport = new StdioServerTransport();
await server.connect(transport);
