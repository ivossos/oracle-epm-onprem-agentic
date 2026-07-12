import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { EpmClient, loadConfig, redactConfig } from "@epm/core-client";
import { core } from "@epm/servers-as-code";
import { writeGuard, type ApprovalPacket } from "@epm/claude-agent/src/policies/write-guard.js";

const client = new EpmClient();

const server = new McpServer({
  name: "oracle-epm-core",
  version: "0.1.0",
});

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
  "epm_config",
  {
    title: "Show EPM connection config (redacted)",
    description: "Returns the active EPM client configuration with all secrets redacted.",
    inputSchema: {},
  },
  async () => ok(redactConfig(loadConfig()))
);

server.registerTool(
  "epm_ping",
  {
    title: "Ping EPM",
    description: "Health check. In mock mode always returns ok.",
    inputSchema: {},
  },
  async () => ok({ ok: true, mode: client.config.mode })
);

server.registerTool(
  "epm_list_applications",
  {
    title: "List applications",
    description: "Lists Planning/FCCS/PCM applications and their cubes.",
    inputSchema: {},
  },
  async () => ok(await core.listApplications())
);

server.registerTool(
  "epm_list_job_definitions",
  {
    title: "List job definitions",
    description: "Lists job definitions for an application.",
    inputSchema: { app: z.string().describe("Application name") },
  },
  async ({ app }) => ok(await core.listJobDefinitions(app))
);

server.registerTool(
  "epm_get_job_status",
  {
    title: "Get job status",
    description: "Returns status/details for a job id.",
    inputSchema: { jobId: z.number().int().describe("Job id") },
  },
  async ({ jobId }) => ok(await core.getJobStatus(jobId))
);

server.registerTool(
  "epm_execute_job",
  {
    title: "Execute job (MUTATING)",
    description:
      "Executes an EPM job. MUTATING: requires a user-confirmed approval packet with complete scope.",
    inputSchema: {
      app: z.string(),
      jobName: z.string(),
      parameters: z.record(z.unknown()).optional(),
      approvalPacket: z.custom<ApprovalPacket>().optional(),
      actor: z.string().default("agent"),
    },
  },
  async ({ app, jobName, parameters, approvalPacket, actor }) => {
    const guard = writeGuard("epm_execute_job", approvalPacket);
    if (!guard.allowed) return blocked(guard.reason ?? "blocked");
    const result = await core.executeJob({
      app,
      jobName,
      approvalPacketId: approvalPacket!.id,
      actor,
      parameters,
    });
    return ok(result);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
