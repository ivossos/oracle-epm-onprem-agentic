# Oracle EPM Agentic Services

Anthropic-native agentic services for **Oracle Cloud EPM (Planning / FCCS / HFM)** and **on-premises Oracle EPM 11.1.2.4+**
built on a thin, typed MCP tool layer. **Mock-first**: every demo, eval, and
tool runs with zero Oracle credentials until you flip `EPM_MODE=live`.

> Status: `0.5.0` — P0 + P1 + P2 scaffold + on-prem support + HFM. Eight MCP servers (core, planning,
> fccs-close, hfm, data-integration, metadata, security-audit, epm-automate-wrapper), all
> wired into agents/skills/permissions; nine subagents, seven skills, approval/write guards,
> and 34 tests (29 evals + 5 on-prem wiring tests) are in place.
> On-prem EPM 11.1.2.4 Basic Auth is live-wired for job listing/execution — endpoint shape
> unconfirmed against a real server, see `docs/onprem-setup.md`. Everything else (Cloud
> OAuth, the rest of the on-prem surface) is still mock-only. A chat-gateway (FastAPI) UI
> and a read-only variance-monitor CLI have also been added.

## Why this shape

The demand clusters around repeated, high-pressure finance/admin work: close
orchestration, data-integration monitoring, metadata validation, Smart View
triage, and safe data extraction. This repo builds:

- one shared `oracle-epm-core` foundation (auth, jobs, files, audit),
- domain MCP service packs (`planning-ops`, `fccs-close`, …),
- an Anthropic-native agent layer (orchestrator + domain subagents + a safety
  evaluator), skills, hooks, and permissions.

Every tool defaults to **read-only / dry-run**. Mutations require a
user-confirmed **approval packet** enforced at three layers (client, agent
guard, Claude Code hook). See `docs/approval-model.md`.

## Layout

```
packages/epm-core-client/   Mock-first EPM client, types, config, audit
servers-as-code/            Typed business fns (code-execution-with-MCP pattern)
mcp/oracle-epm-core/        Core MCP server (stdio)
mcp/planning-ops/           Planning MCP server
mcp/fccs-close/             FCCS close MCP server
mcp/hfm/                    HFM consolidation MCP server
mcp/data-integration-watchtower/  Data Integration / Data Management MCP server
mcp/metadata-governance/    Metadata snapshot / diff / risk MCP server
mcp/security-audit/         Security & access reporting MCP server (read-only)
mcp/epm-automate-wrapper/   Allowlisted EPM Automate MCP server (no arbitrary shell)
apps/claude-agent/          Orchestrator, policies, evals
.claude/                    agents/, skills/, hooks/, settings.json
fixtures/                   mock-planning/, mock-fccs/, mock-hfm/, mock-data-integration/, mock-metadata/, mock-security/, mock-automate/
docs/                       api-mapping.md, approval-model.md, onprem-setup.md
```

## Deployment Modes

### Cloud EPM (Oracle Cloud)

```bash
EPM_MODE=live
EPM_DEPLOYMENT=cloud
EPM_BASE_URL=https://<pod>.epm.<dc>.oraclecloud.com
EPM_OAUTH_TOKEN_URL=...  # Recommended for production
# Or Basic Auth if MFA not required
EPM_USERNAME=user
EPM_PASSWORD=pass
```

### On-Premises EPM 11.1.2.4+

```bash
EPM_MODE=live
EPM_DEPLOYMENT=onprem
EPM_SERVER_HOSTNAME=epm-server.internal
EPM_SERVER_PORT=8080
EPM_USE_HTTPS=false
EPM_USERNAME=admin
EPM_PASSWORD=pass
```

See **[docs/onprem-setup.md](docs/onprem-setup.md)** for detailed on-prem configuration,
SSL handling, networking, and troubleshooting.

## Quick start

```bash
npm install
npm run typecheck        # tsc --noEmit across the monorepo
npm test                 # vitest: close-readiness, planning-export, destructive-action
npm run demo             # runnable mock orchestrator demo (no creds)
```

### Run an MCP server (stdio)

```bash
npm run mcp:core         # oracle-epm-core
npm run mcp:planning     # planning-ops
npm run mcp:fccs         # fccs-close
npm run mcp:hfm          # hfm (consolidation)
npm run mcp:di           # data-integration-watchtower
npm run mcp:metadata     # metadata-governance
npm run mcp:security     # security-audit
npm run mcp:automate     # epm-automate-wrapper
```

Point a Claude Code / MCP client at these via stdio. The default profile in
`.claude/settings.json` allow-lists read-only tools and gates `epm_execute_job`
behind the pre-write hook.

## Live mode (later)

Copy `.env.example` to `.env`, set `EPM_MODE=live`, and provide either Basic
Auth (non-MFA) or OAuth 2.0 credentials. OAuth is recommended for production
because MFA breaks Basic-Auth-only flows. Credentials never appear in prompts,
tool results, or logs (see `redactConfig` and the redaction guard).

## Safety model (summary)

- Read-only default; `*_dry_run` / `*_plan` always read-only.
- Mutating actions need an approval packet with full scope
  (environment, application, cube, scenario, version, period, entity).
- Three enforcement layers: client contract, agent write-guard, Claude Code
  PreToolUse hook.
- Append-only JSONL audit trail for every mutation.
