---
name: data-load-diagnostics
description: Use for failed Data Integration / Data Management loads and weak scheduled-pipeline visibility. Covers pipeline inventory, POV locks, failed rows, and mapping export analysis.
---

# Data Load Diagnostics

Use this when the user asks "which loads failed", "why did the nightly load
break", "what pipelines run", or "the forecast won't load".

## Steps

1. `di_schedule_inventory` — what pipelines exist, their cron schedule, enabled
   state, and which integrations they run. This is the answer to weak scheduled
   -load visibility.
2. `di_failed_load_summary` — failed + partial jobs, total rejected rows, and
   rejection reasons clustered (row-specific detail normalized out).
3. `di_diagnose_failures` — correlates failures to POV-lock blockers. A `FAILED`
   job whose reason mentions "POV locked" means the target intersection is
   locked, not a data problem.
4. `di_export_mapping` — inspect mapping rules for the failing integration when
   the reason is "unmapped member".

## Common causes → next action

- **Unmapped member** → add/adjust a mapping rule (mutating; route to evaluator).
- **POV locked** → unlock the POV or load a different scenario (mutating).
- **Amount not numeric** → source data quality; fix at source, re-run.

## Never

- Do not run an integration, run a data rule, or lock/unlock a POV from this
  skill. Produce a plan and route it to the safety evaluator for an approval
  packet.
