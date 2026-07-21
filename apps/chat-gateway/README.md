# chat-gateway

Python FastAPI backend for the `static/index.html` chat dashboard. Wires the
dashboard's `/api/chat` + `/api/approve` contract to MCP servers in this repo
(mock mode; no Oracle credentials needed) via an Anthropic tool-use loop.

All 8 MCP servers in the repo are wired up (see `app/config.py`'s
`MCP_SERVER_SCRIPTS`):
- `planning-ops` -- data slices, variance snapshot, substitution variables (read-only).
- `oracle-epm-core` -- applications, job definitions/status, and
  `epm_execute_job` (MUTATING).
- `fccs-close` -- close readiness, metadata validation, journals,
  intercompany matching (read-only).
- `hfm` -- consolidation tools (read-only).
- `data-integration-watchtower` -- pipeline inventory, failed loads, POV
  locks (read-only).
- `metadata-governance` -- snapshots, diffs, member impact risk (read-only).
- `security-audit` -- role/access/login reports (read-only).
- `epm-automate-wrapper` -- allowlisted commands; `automate_run_approved_command`
  is MUTATING.

Two tools are MUTATING and exercise the approval-gate UI: `epm_execute_job`
and `automate_run_approved_command`. Either one makes the gateway pause the
turn and return `status: "awaiting_approval"` until `/api/approve` confirms
or denies it.

## Setup

```bash
cd apps/chat-gateway
python3 -m venv .venv
.venv/bin/python -m ensurepip --upgrade
.venv/bin/pip install -r requirements.txt
```

`ANTHROPIC_API_KEY` must be set in the environment (see `.env.example`).

## Run

From the repo root (so the relative MCP server path resolves) or from this
directory -- `app/config.py` resolves paths off `__file__`, so cwd doesn't
matter:

```bash
apps/chat-gateway/.venv/bin/uvicorn app.main:app --app-dir apps/chat-gateway --port 8000
```

Then open `http://localhost:8000/` (same-origin, avoids `file://` CORS
issues).
