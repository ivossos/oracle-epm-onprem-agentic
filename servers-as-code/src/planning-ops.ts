import { EpmClient } from "@epm/core-client";
import type { BoundedResult, DataSliceRow } from "@epm/core-client";
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
}): Promise<BoundedResult<DataSliceRow>> {
  const slice = await client.exportDataSlice(args.app, args.cube);
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
}): Promise<BoundedResult<VarianceRow>> {
  const threshold = args.thresholdPct ?? 0.05;
  const slice = await client.exportDataSlice(args.app, args.cube);

  // Group rows by every member dimension except Cenario.
  const groups = new Map<string, { members: Record<string, string>; actual: number | null; forecast: number | null }>();
  for (const row of slice.rows) {
    const { Cenario, ...rest } = row.members;
    const key = Object.entries(rest)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("|");
    const g = groups.get(key) ?? { members: rest, actual: null, forecast: null };
    if (Cenario === "Actual") g.actual = row.value;
    else if (Cenario === "Forecast") g.forecast = row.value;
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
