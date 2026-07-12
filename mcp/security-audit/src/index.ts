import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { security } from "@epm/servers-as-code";

const server = new McpServer({ name: "security-audit", version: "0.1.0" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  "security_role_assignment_report",
  {
    title: "Role assignment report (read-only)",
    description: "Lists user-to-role assignments per application.",
    inputSchema: {},
  },
  async () => ok(await security.roleAssignmentReport())
);

server.registerTool(
  "security_user_access_report",
  {
    title: "User access report (read-only)",
    description:
      "Summarizes user access and highlights MFA gaps and stale (unused) accounts.",
    inputSchema: {
      staleDays: z.number().optional().describe("Days since last login to flag as stale (default 90)"),
    },
  },
  async ({ staleDays }) => ok(await security.userAccessReport({ staleDays }))
);

server.registerTool(
  "security_invalid_login_report",
  {
    title: "Invalid login report (read-only)",
    description:
      "Clusters failed logins by source IP and flags brute-force suspects.",
    inputSchema: {
      bruteForceThreshold: z
        .number()
        .optional()
        .describe("Failed attempts from one IP to flag (default 3)"),
    },
  },
  async ({ bruteForceThreshold }) =>
    ok(await security.invalidLoginReport({ bruteForceThreshold }))
);

server.registerTool(
  "security_group_assignment_audit",
  {
    title: "Group assignment audit (read-only)",
    description: "Lists group memberships.",
    inputSchema: {},
  },
  async () => ok(await security.groupAssignmentAudit())
);

server.registerTool(
  "security_compare_access_snapshots",
  {
    title: "Compare access snapshots (read-only)",
    description:
      "Diffs two access snapshots: granted / revoked / role-changed users.",
    inputSchema: {
      from: z.string().default("baseline"),
      to: z.string().default("current"),
    },
  },
  async ({ from, to }) => ok(await security.compareAccessSnapshots({ from, to }))
);

const transport = new StdioServerTransport();
await server.connect(transport);
