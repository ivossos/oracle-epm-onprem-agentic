---
name: epm-automate-runbooks
description: Use for allowlisted EPM Automate operations — daily backup, snapshot download, file upload, Smart View load replay, and runbook status. Never runs arbitrary shell.
---

# EPM Automate Runbooks

Use this when the user asks to run a backup, download a snapshot, upload a file,
replay a Smart View / REST load, or check runbook status.

## Steps

1. `automate_list_commands` — confirm the operation is on the typed allowlist.
   If it is not, stop: there is no arbitrary-shell path by design.
2. `automate_runbook_status` — check the last run/status before re-running.
3. `automate_run_approved_command`:
   - Read-only (downloadSnapshot, listFiles) → runs directly.
   - Mutating (runDailyMaintenance, uploadFile, replay) → build an approval
     packet, route to the safety evaluator, run only after user confirmation.

## Allowlisted commands (mock)

| Command | Mutating | Required params |
| --- | --- | --- |
| downloadSnapshot | no | snapshotName |
| listFiles | no | — |
| runDailyMaintenance | yes | — |
| uploadFile | yes | fileName |
| replay | yes | loadName |

## Pitfalls

- Required params are enforced at the client layer; a missing param is refused
  before anything runs.
- Every mutating run is audited (JSONL) and returns command, status, elapsed
  time, and an artifact/log path.

## Never

- Do not attempt to run commands not on the allowlist, and never construct raw
  `epmautomate` shell strings.
