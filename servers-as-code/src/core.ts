import { EpmClient, audit } from "@epm/core-client";
import type { Application, JobDefinition, JobResult } from "@epm/core-client";

const client = new EpmClient();

export async function listApplications(): Promise<Application[]> {
  return client.listApplications();
}

export async function listJobDefinitions(app: string): Promise<JobDefinition[]> {
  return client.listJobDefinitions(app);
}

export async function getJobStatus(jobId: number): Promise<JobResult> {
  return client.getJobStatus(jobId);
}

/**
 * Mutating. Requires an approval packet id. Writes an audit record.
 */
export async function executeJob(args: {
  app: string;
  jobName: string;
  approvalPacketId: string;
  actor: string;
  parameters?: Record<string, unknown>;
}): Promise<JobResult> {
  const result = await client.executeJob(
    args.app,
    args.jobName,
    args.approvalPacketId,
    args.parameters
  );
  audit({
    actor: args.actor,
    action: `executeJob:${args.jobName}`,
    mutating: true,
    scope: { app: args.app, jobName: args.jobName },
    requestPayload: args.parameters ?? {},
    jobId: result.jobId,
    status: result.status,
    approvalPacketId: args.approvalPacketId,
    mode: client.config.mode,
  });
  return result;
}
