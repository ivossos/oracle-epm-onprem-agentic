import { EpmClient } from "@epm/core-client";
import type {
  HfmEntity,
  HfmConsolidationStatus,
  HfmIcTransaction,
  HfmBalancingStatus,
  HfmConsolidationReport,
  HfmCurrencyConversion,
  HfmExtractSpec,
} from "@epm/core-client";

const client = new EpmClient();

export async function listHfmEntities(app: string): Promise<HfmEntity[]> {
  return client.listHfmEntities(app);
}

export async function getConsolidationStatus(
  app: string,
  filter?: { period?: string; scenario?: string }
): Promise<HfmConsolidationStatus[]> {
  return client.getConsolidationStatus(app, filter);
}

export async function listIntercompanyTransactions(
  app: string,
  filter?: { status?: string }
): Promise<HfmIcTransaction[]> {
  return client.listIntercompanyTransactions(app, filter);
}

export async function getBalancingStatus(
  app: string,
  filter?: { entity?: string; period?: string }
): Promise<HfmBalancingStatus[]> {
  return client.getBalancingStatus(app, filter);
}

export async function getConsolidationReport(
  app: string,
  period: string
): Promise<HfmConsolidationReport> {
  return client.getConsolidationReport(app, period);
}

export async function listCurrencyConversions(
  app: string
): Promise<HfmCurrencyConversion[]> {
  return client.listCurrencyConversions(app);
}

export async function listHfmExtracts(app: string): Promise<HfmExtractSpec[]> {
  return client.listHfmExtracts(app);
}

/**
 * Consolidation health check: aggregates entity status, balancing, IC transactions,
 * and data quality issues into a single report.
 */
export interface ConsolidationHealthCheck {
  period: string;
  totalEntities: number;
  consolidatedEntities: number;
  completionPercentage: number;
  readyForSubmit: boolean;
  blockers: string[];
  warnings: string[];
  balancingIssues: { entity: string; difference: number }[];
  pendingIcTransactions: number;
}

export async function consolidationHealthCheck(args: {
  app: string;
  period: string;
}): Promise<ConsolidationHealthCheck> {
  const [status, balancing, report, ic] = await Promise.all([
    getConsolidationStatus(args.app, { period: args.period }),
    getBalancingStatus(args.app, { period: args.period }),
    getConsolidationReport(args.app, args.period),
    listIntercompanyTransactions(args.app, { status: "Pending" }),
  ]);

  const unbalanced = balancing.filter((b) => !b.balanced);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (unbalanced.length > 0) {
    blockers.push(`${unbalanced.length} entity(ies) are unbalanced`);
  }
  if (ic.length > 0) {
    blockers.push(`${ic.length} inter-company transaction(s) pending confirmation`);
  }

  const needsReview = status.filter((s) => s.status === "Needs Review");
  if (needsReview.length > 0) {
    warnings.push(`${needsReview.length} entity(ies) pending supervisory review`);
  }

  const inProgress = status.filter((s) => s.status === "In Progress");
  if (inProgress.length > 0) {
    warnings.push(`${inProgress.length} entity(ies) still consolidating`);
  }

  return {
    period: args.period,
    totalEntities: report.entities,
    consolidatedEntities: report.consolidated,
    completionPercentage: report.completionPercentage,
    readyForSubmit: blockers.length === 0 && report.completionPercentage >= 95,
    blockers,
    warnings,
    balancingIssues: unbalanced.map((b) => ({
      entity: b.entity,
      difference: b.difference,
    })),
    pendingIcTransactions: ic.length,
  };
}
