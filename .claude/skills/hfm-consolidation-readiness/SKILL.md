---
name: hfm-consolidation-readiness
description: Use for HFM (on-prem) consolidation status checks — entity completion, balancing issues, and pending intercompany transactions. Read-only.
---

# HFM Consolidation Readiness

Use this when the user asks about consolidation status, "are entities
balanced", "what's pending in HFM", or runs a month-end HFM close preflight.

## Steps

1. `hfm_list_entities` — confirm the entity hierarchy for the app.
2. `hfm_consolidation_health_check` — the aggregate go/no-go for a period. Runs
   consolidation status, balancing, IC transactions, and the consolidation
   report in parallel.
3. If blockers exist, drill in with `hfm_consolidation_status`,
   `hfm_balancing_status`, and `hfm_intercompany_transactions`.
4. Cross-check `hfm_currency_conversions` if balancing issues look FX-related.
5. Summarize: **what's ready, what's blocking, what to do next** — with
   entity names and completion percentage finance can attach to a close
   ticket.

## Blockers (hard stop)

- Any unbalanced entity (`hfm_balancing_status`).
- Pending (unconfirmed) intercompany transactions.

## Warnings (proceed with caution)

- Entities still "In Progress".
- Entities "Needs Review" (pending supervisory review).

## Never

- Do not trigger a consolidation run, lock a period, or change currency rates
  from this skill — no such tools are exposed. Any future write action must
  go through the safety evaluator for an approval packet.
