import { EpmClient } from "@epm/core-client";
import type {
  IntercompanyMatch,
  Journal,
  MetadataValidationResult,
} from "@epm/core-client";

const client = new EpmClient();

export async function validateMetadata(
  app: string
): Promise<MetadataValidationResult> {
  return client.validateMetadata(app);
}

export async function retrieveJournals(
  filter?: Partial<Journal>
): Promise<Journal[]> {
  return client.retrieveJournals(filter);
}

export async function intercompanyMatchingReport(): Promise<IntercompanyMatch[]> {
  return client.intercompanyMatching();
}

export interface CloseReadinessReport {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  metadata: { errors: number; warnings: number };
  journals: {
    total: number;
    unposted: number;
    unbalanced: number;
    byStatus: Record<string, number>;
  };
  intercompany: { total: number; unmatched: number; totalDifference: number };
}

/**
 * Read-only close readiness aggregation. This is the flagship P0 report:
 * "what changed, what failed, and what should I do next?"
 */
export async function closeReadinessReport(args: {
  app: string;
  period?: string;
}): Promise<CloseReadinessReport> {
  const [metadata, journals, ic] = await Promise.all([
    client.validateMetadata(args.app),
    client.retrieveJournals(args.period ? { period: args.period } : undefined),
    client.intercompanyMatching(),
  ]);

  const byStatus: Record<string, number> = {};
  for (const j of journals) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;

  const unposted = journals.filter((j) => j.status !== "Posted").length;
  const unbalanced = journals.filter((j) => !j.balanced).length;
  const unmatched = ic.filter((m) => !m.matched);
  const totalDifference = unmatched.reduce(
    (sum, m) => sum + Math.abs(m.difference),
    0
  );

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (metadata.errors > 0)
    blockers.push(`Metadata validation has ${metadata.errors} error(s)`);
  if (unbalanced > 0)
    blockers.push(`${unbalanced} journal(s) are unbalanced`);
  if (unmatched.length > 0)
    blockers.push(
      `${unmatched.length} intercompany pair(s) unmatched (diff ${totalDifference})`
    );

  if (metadata.warnings > 0)
    warnings.push(`Metadata has ${metadata.warnings} warning(s)`);
  if (unposted > 0) warnings.push(`${unposted} journal(s) not yet posted`);

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    metadata: { errors: metadata.errors, warnings: metadata.warnings },
    journals: {
      total: journals.length,
      unposted,
      unbalanced,
      byStatus,
    },
    intercompany: {
      total: ic.length,
      unmatched: unmatched.length,
      totalDifference,
    },
  };
}
