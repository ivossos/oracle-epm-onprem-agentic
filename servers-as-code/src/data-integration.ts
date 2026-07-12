import { EpmClient } from "@epm/core-client";
import type {
  IntegrationJob,
  Mapping,
  Pipeline,
  PovLock,
} from "@epm/core-client";

const client = new EpmClient();

export interface PipelineInventoryEntry extends Pipeline {
  integrationNames: string[];
}

/** Inventory of pipelines + their integrations. Directly addresses the
 *  "scheduled Data Management visibility is weak" complaint. */
export async function scheduleInventory(): Promise<PipelineInventoryEntry[]> {
  const [pipelines, integrations] = await Promise.all([
    client.listPipelines(),
    client.listIntegrations(),
  ]);
  const nameById = new Map(integrations.map((i) => [i.integrationId, i.name]));
  return pipelines.map((p) => ({
    ...p,
    integrationNames: p.integrations.map((id) => nameById.get(id) ?? id),
  }));
}

export async function listPipelines(): Promise<Pipeline[]> {
  return client.listPipelines();
}

export async function getJobStatus(): Promise<IntegrationJob[]> {
  return client.listIntegrationJobs();
}

export interface FailedLoadSummary {
  totalJobs: number;
  failed: number;
  completedWithErrors: number;
  totalRowsRejected: number;
  byReason: { reason: string; count: number }[];
  jobs: {
    jobId: number;
    integrationId: string;
    status: string;
    rowsRejected: number;
    sampleReasons: string[];
  }[];
}

/** Summarizes failed / partial data loads and clusters rejection reasons. */
export async function failedLoadSummary(): Promise<FailedLoadSummary> {
  const jobs = await client.listIntegrationJobs();
  const problem = jobs.filter(
    (j) => j.status === "FAILED" || j.status === "COMPLETED_WITH_ERRORS"
  );

  const reasonCounts = new Map<string, number>();
  for (const j of problem) {
    for (const f of j.failedRows ?? []) {
      // Normalize row-specific detail out so reasons cluster.
      const key = f.reason.replace(/'[^']*'/g, "'…'").replace(/\d+/g, "#");
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    totalJobs: jobs.length,
    failed: jobs.filter((j) => j.status === "FAILED").length,
    completedWithErrors: jobs.filter((j) => j.status === "COMPLETED_WITH_ERRORS")
      .length,
    totalRowsRejected: problem.reduce((s, j) => s + j.rowsRejected, 0),
    byReason: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    jobs: problem.map((j) => ({
      jobId: j.jobId,
      integrationId: j.integrationId,
      status: j.status,
      rowsRejected: j.rowsRejected,
      sampleReasons: (j.failedRows ?? []).slice(0, 5).map((f) => f.reason),
    })),
  };
}

export async function exportMapping(integrationId: string): Promise<Mapping[]> {
  return client.exportMapping(integrationId);
}

export async function povLockStatus(): Promise<PovLock[]> {
  return client.listPovLocks();
}

/** Correlates failed loads with a POV-lock cause when present. */
export async function diagnoseFailures(): Promise<{
  summary: FailedLoadSummary;
  lockedBlockers: PovLock[];
}> {
  const [summary, locks] = await Promise.all([
    failedLoadSummary(),
    client.listPovLocks(),
  ]);
  const lockReasonPresent = summary.jobs.some((j) =>
    j.sampleReasons.some((r) => /POV locked/i.test(r))
  );
  return {
    summary,
    lockedBlockers: lockReasonPresent ? locks.filter((l) => l.locked) : [],
  };
}
