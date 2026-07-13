# CLAUDE.md — oracle-epm-agentic-services

Anthropic-native agentic services for Oracle Cloud EPM (Planning / FCCS). Seven MCP servers, eight subagents, six skills, approval/write guards, and 29 evals. Mock-first — zero Oracle credentials needed until `EPM_MODE=live`.

## Quick start

```bash
npm install
npm run typecheck   # tsc --noEmit across the monorepo
npm test            # vitest
npm run demo        # mock orchestrator demo, no creds
```

## MCP servers

| Server | npm script | Domain |
|---|---|---|
| oracle-epm-core | `mcp:core` | Auth, jobs, files, audit |
| planning-ops | `mcp:planning` | Data exports, business rules, substitution vars |
| fccs-close | `mcp:fccs` | Close readiness, journals, IC matching |
| data-integration-watchtower | `mcp:di` | Pipeline inventory, failed loads, POV locks |
| metadata-governance | `mcp:metadata` | Snapshots, diffs, dynamic-calc risk |
| security-audit | `mcp:security` | Roles, MFA gaps, stale accounts, login audit |
| epm-automate-wrapper | `mcp:automate` | Allowlisted EPM Automate commands only |

Run via stdio; point a Claude Code / MCP client at the matching script.

## Agents (`.claude/agents/`)

| Agent | Role |
|---|---|
| `epm-orchestrator` | Routes requests to the right domain subagent; never calls mutating tools directly |
| `planning-operator` | Data exports, business rules, substitution vars, cube refresh preflights |
| `fccs-close` | Close readiness, journal state, IC reports, data copy/clear preflights |
| `data-integration-watchtower` | Pipeline inventory, failed-load summaries, mapping exports — read-only |
| `metadata-governance` | Snapshots, drift detection, dynamic-calc risk, member impact — read-only |
| `security-audit` | Role/access reports, MFA gaps, brute-force logins, access drift — read-only |
| `epm-automate` | Allowlisted EPM Automate operations only; no arbitrary shell |
| `epm-safety-evaluator` | Reviews every proposed write; produces an approval packet or blocks |

## Skills (`.claude/skills/`)

| Skill | When to use |
|---|---|
| `epm-close-readiness` | Month-end / quarter-end close preflight |
| `planning-data-slice` | Planning exports, variance, actual-vs-forecast |
| `data-load-diagnostics` | Failed DI/DM loads, pipeline visibility |
| `metadata-diff` | Metadata drift, failed cube refresh, outline risk |
| `security-access-review` | Access certifications, MFA gaps, login audit |
| `epm-automate-runbooks` | Backup, snapshot download, file upload, Smart View replay |

## Safety model

- **Read-only by default.** All `*_dry_run` / `*_plan` tools are always read-only.
- **Mutations require an approval packet** with full scope: environment, application, cube, scenario, version, period, entity.
- **Three enforcement layers:** client contract → agent write-guard → Claude Code `PreToolUse` hook (`pre-write-guard.mjs`).
- **Append-only JSONL audit trail** for every mutation.
- The `epm-safety-evaluator` agent reviews every proposed write and returns `approved_for_user_confirmation` or `blocked`. Never approve a destructive action inside an autonomous loop.

## Permissions (`.claude/settings.json`)

- **Auto-allowed:** all read-only tools across all seven MCP servers.
- **Ask (user confirmation):** `epm_execute_job`, `automate_run_approved_command`.
- **Hook-gated:** any tool matching `execute_job | post_journal | clear_data | copy_data | import_* | refresh_cube | update_substitution_variable | run_business_rule | automate_run`.

## POV conventions (Planning — mock fixtures)

- `Ano` (year): e.g. `FY26`
- `Periodo` (period): e.g. `Jun`
- `Cenario` (scenario): `Actual` | `Forecast` | `Budget`
- `Versao` (version): e.g. `Trabalho`
- `Filial` (entity/branch): e.g. `SP`, `RJ`

## Live mode

Copy `.env.example` to `.env`, set `EPM_MODE=live`, and provide Basic Auth or OAuth 2.0 credentials. OAuth is recommended — MFA breaks Basic-Auth flows. Credentials are never surfaced in prompts, tool results, or logs (see `redactConfig`).

## Layout

```
packages/epm-core-client/          Mock-first EPM client, types, config, audit
servers-as-code/                   Typed business functions
mcp/oracle-epm-core/               Core MCP server
mcp/planning-ops/                  Planning MCP server
mcp/fccs-close/                    FCCS close MCP server
mcp/data-integration-watchtower/   DI/DM MCP server
mcp/metadata-governance/           Metadata MCP server
mcp/security-audit/                Security MCP server (read-only)
mcp/epm-automate-wrapper/          EPM Automate MCP server (allowlisted only)
apps/claude-agent/                 Orchestrator, policies, evals
.claude/                           agents/, skills/, hooks/, settings.json
fixtures/                          Mock data for all domains
docs/                              api-mapping.md, approval-model.md
```
