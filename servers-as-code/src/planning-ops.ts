import { EpmClient, audit } from "@epm/core-client";
import type { BoundedResult, BusinessRule, DataSliceRow, JobResult } from "@epm/core-client";
import { boundAndPersist } from "./_util.js";

const client = new EpmClient();

export interface VarianceRow {
  key: string;
  members: Record<string, string>;
  actual: number | null;
  forecast: number | null;
  variance: number | null;
  variancePct: number | null;
}

/**
 * Exports a Planning data slice and returns a bounded envelope.
 * Full extract is persisted to the artifact path.
 */
export async function exportDataSlice(args: {
  app: string;
  cube: string;
  /** On-prem: pass-through Essbase MDX query. Defaults to the demo slice. */
  mdx?: string;
}): Promise<BoundedResult<DataSliceRow>> {
  const slice = await client.exportDataSlice(args.app, args.cube, args.mdx);
  return boundAndPersist(
    slice.rows,
    `artifacts/exports/${args.app}_${args.cube}_slice.json`
  );
}

/**
 * Computes an actual-vs-forecast variance snapshot from a data slice.
 * Returns exceptions (missing data or |variance%| over threshold) bounded.
 */
export async function varianceSnapshot(args: {
  app: string;
  cube: string;
  thresholdPct?: number;
  /** On-prem: pass-through Essbase MDX query (should place Scenario on an axis). */
  mdx?: string;
  /**
   * Scenario dimension key. Auto-detected from the row members when omitted
   * (the live cube uses English `Scenario`; the mock fixtures use `Cenario`).
   */
  scenarioDim?: string;
  /** Scenario member treated as "actual". Default `Actual`. */
  actualMember?: string;
  /**
   * Scenario member treated as the baseline to compare against. Default
   * `Forecast`; pass `Plan` for a budget-vs-actual variance.
   */
  baselineMember?: string;
}): Promise<BoundedResult<VarianceRow>> {
  const threshold = args.thresholdPct ?? 0.05;
  const actualMember = args.actualMember ?? "Actual";
  const baselineMember = args.baselineMember ?? "Forecast";
  const slice = await client.exportDataSlice(args.app, args.cube, args.mdx);

  // Identify the scenario dimension by name: an explicit arg wins, otherwise the
  // first known convention present on the row (`Scenario` live, `Cenario` mock).
  const scenarioKeys = ["Scenario", "Cenario"];
  const scenarioDimOf = (members: Record<string, string>): string | undefined =>
    args.scenarioDim ?? scenarioKeys.find((k) => k in members);

  // Group rows by every member dimension except the scenario dimension.
  const groups = new Map<string, { members: Record<string, string>; actual: number | null; forecast: number | null }>();
  for (const row of slice.rows) {
    const scenarioDim = scenarioDimOf(row.members);
    const scenario = scenarioDim ? row.members[scenarioDim] : undefined;
    const rest = { ...row.members };
    if (scenarioDim) delete rest[scenarioDim];
    const key = Object.entries(rest)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("|");
    const g = groups.get(key) ?? { members: rest, actual: null, forecast: null };
    if (scenario === actualMember) g.actual = row.value;
    else if (scenario === baselineMember) g.forecast = row.value;
    groups.set(key, g);
  }

  const rows: VarianceRow[] = [];
  for (const [key, g] of groups) {
    const variance =
      g.actual !== null && g.forecast !== null ? g.actual - g.forecast : null;
    const variancePct =
      variance !== null && g.forecast !== null && g.forecast !== 0
        ? variance / Math.abs(g.forecast)
        : null;
    rows.push({ key, members: g.members, actual: g.actual, forecast: g.forecast, variance, variancePct });
  }

  const exceptions = rows.filter(
    (r) =>
      r.actual === null ||
      r.forecast === null ||
      (r.variancePct !== null && Math.abs(r.variancePct) > threshold)
  );

  return boundAndPersist(
    exceptions,
    `artifacts/exports/${args.app}_${args.cube}_variance.json`
  );
}

export async function getSubstitutionVariables(app: string) {
  return client.getSubstitutionVariables(app);
}

/**
 * Lists business rules (Calc Manager rules / Essbase calc scripts) for a cube,
 * with an optional case-insensitive name filter and a bounded result.
 */
export async function listBusinessRules(args: {
  app: string;
  cube: string;
  filter?: string;
  limit?: number;
}): Promise<{ total: number; matched: number; returned: number; rules: BusinessRule[] }> {
  const all = await client.listBusinessRules(args.app, args.cube);
  const q = args.filter?.toLowerCase();
  const filtered = q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all;
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 500);
  return {
    total: all.length,
    matched: filtered.length,
    returned: Math.min(filtered.length, limit),
    rules: filtered.slice(0, limit),
  };
}

/** Returns one business rule's calc-script content. */
export async function getBusinessRule(args: {
  app: string;
  cube: string;
  name: string;
}): Promise<{ name: string; content: string } | null> {
  return client.getBusinessRule(args.app, args.cube, args.name);
}

/**
 * Mutating. Runs a business rule (Essbase calc script) via the Essbase REST v1
 * calc-job API. Requires an approval packet id; writes an audit record. Get the
 * rule name from `listBusinessRules`; inspect it first with `getBusinessRule`.
 */
export async function runBusinessRule(args: {
  app: string;
  cube: string;
  ruleName: string;
  approvalPacketId: string;
  actor: string;
  parameters?: Record<string, string>;
}): Promise<JobResult> {
  const result = await client.runBusinessRule({
    app: args.app,
    cube: args.cube,
    ruleName: args.ruleName,
    approvalPacketId: args.approvalPacketId,
    parameters: args.parameters,
  });
  audit({
    actor: args.actor,
    action: `runBusinessRule:${args.ruleName}`,
    mutating: true,
    scope: { app: args.app, cube: args.cube, ruleName: args.ruleName },
    requestPayload: args.parameters ?? {},
    jobId: result.jobId,
    status: result.status,
    approvalPacketId: args.approvalPacketId,
    mode: client.config.mode,
  });
  return result;
}

/**
 * Composes an Essbase MDX grid query from resolved member names — the bridge
 * between member lookup (`dimensions.findMembers`) and `exportDataSlice`.
 * `columns`/`rows` become member sets on each axis; `pov` members are fixed in
 * the WHERE clause as a left-nested CrossJoin (the form proven against CORPRPT).
 */
export function buildMdx(args: {
  columns: string[];
  rows: string[];
  pov?: string[];
}): string {
  const set = (members: string[]) => `{${members.join(", ")}}`;
  const select = `SELECT ${set(args.columns)} ON COLUMNS, ${set(args.rows)} ON ROWS`;
  const pov = args.pov ?? [];
  if (pov.length === 0) return select;
  let where = `{${pov[0]}}`;
  for (let i = 1; i < pov.length; i++) where = `CrossJoin(${where}, {${pov[i]}})`;
  return `${select} WHERE (${where})`;
}
