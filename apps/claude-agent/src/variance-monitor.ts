/**
 * Read-only variance monitor: resolves the current period from substitution
 * variables, runs an actual-vs-forecast variance snapshot, and reports
 * exceptions. No approval packet needed — this never mutates the app.
 *
 * Exit code is 1 when exceptions exist (missing data or |variance%| over
 * threshold), 0 otherwise — wire this into cron/CI to alert on a nonzero exit.
 */
import { planning } from "@epm/servers-as-code";

export interface VarianceMonitorArgs {
  app: string;
  cube: string;
  thresholdPct?: number;
}

export async function runVarianceMonitor(args: VarianceMonitorArgs) {
  const subVars = await planning.getSubstitutionVariables(args.app);
  const currentYear = subVars.find((v) => v.name === "CurrentYear")?.value;
  const currentMonth = subVars.find((v) => v.name === "CurrentMonth")?.value;

  const result = await planning.varianceSnapshot(args);

  const missing = result.sample.filter((r) => r.actual === null || r.forecast === null);
  const overThreshold = result.sample.filter(
    (r) => r.actual !== null && r.forecast !== null
  );

  return { currentYear, currentMonth, result, missing, overThreshold };
}

async function main(): Promise<void> {
  const app = process.argv[2] ?? "Financ";
  const cube = process.argv[3] ?? "ORC_Plan";
  const thresholdPct = process.argv[4] ? Number(process.argv[4]) : undefined;

  const { currentYear, currentMonth, result, missing, overThreshold } =
    await runVarianceMonitor({ app, cube, thresholdPct });

  console.log(`=== Variance monitor: ${app}/${cube} — POV ${currentYear ?? "?"}/${currentMonth ?? "?"} ===\n`);
  console.log(`Exceptions: ${result.totalRows} (${missing.length} missing data, ${overThreshold.length} over threshold)`);
  console.log(`Artifact: ${result.artifactPath}\n`);

  for (const row of result.sample) {
    const tag = row.actual === null || row.forecast === null ? "MISSING" : "VARIANCE";
    const pct = row.variancePct !== null ? `${(row.variancePct * 100).toFixed(1)}%` : "n/a";
    console.log(`  [${tag}] ${row.key} — actual=${row.actual ?? "null"} forecast=${row.forecast ?? "null"} variance%=${pct}`);
  }

  if (result.totalRows === 0) {
    console.log("No exceptions — clean.");
  }

  process.exit(result.totalRows > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
