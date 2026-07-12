---
name: epm-close-readiness
description: Use for FCCS month-end or quarter-end close checks. Produces a go/no-go readiness picture from metadata validation, journal state, and intercompany matching — read-only.
---

# EPM Close Readiness

Use this when the user asks about close status, "are we ready to close",
consolidation preflight, or "what's blocking the close".

## Steps

1. `epm_ping` / `epm_config` — confirm environment and mode.
2. `epm_list_applications` — confirm the FCCS app name and cube.
3. `fccs_close_readiness_report` — the aggregate go/no-go. This runs metadata
   validation + journal inventory + intercompany matching in parallel.
4. If blockers exist, drill in with `fccs_validate_metadata`,
   `fccs_retrieve_journals`, and `fccs_intercompany_matching_report`.
5. Extract job console / audit for evidence.
6. Summarize: **what changed, what failed, what to do next** — with artifact
   paths finance can attach to a close ticket.

## Blockers (hard stop)

- Metadata validation errors > 0.
- Unbalanced journals.
- Unmatched intercompany pairs.

## Warnings (proceed with caution)

- Metadata warnings, unposted journals.

## Never

- Do not post/approve journals or clear/copy data from this skill. Hand any
  proposed mutation to the safety evaluator for an approval packet.
