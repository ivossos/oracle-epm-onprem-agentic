# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Anthropic-native agentic services for Oracle Cloud EPM (Planning / FCCS) and on-premises Oracle EPM 11.1.2.4+ (HFM), built on a thin, typed MCP tool layer. **Mock-first**: every demo, eval, and tool runs with zero Oracle credentials until `EPM_MODE=live` — and live mode is currently a stub (see "Mock-first vs. live mode" below).

## Commands

```bash
npm install
npm run typecheck        # tsc -p tsconfig.json --noEmit, across the whole monorepo (no per-package tsconfig)
npm test                 # vitest run — all *.eval.ts and *.test.ts
npm run test:watch       # vitest (watch mode)
npm run evals            # vitest run apps/claude-agent/src/evals  (29 eval cases across 7 files)
npm run demo             # runnable mock orchestrator demo, no creds — tsx apps/claude-agent/src/orchestrator.ts
```

Run a single eval file or test case directly with vitest (there's no per-package test script):

```bash
npx vitest run apps/claude-agent/src/evals/close-readiness.eval.ts
npx vitest run -t "some test name"
```

### Run an MCP server (stdio)

```bash
npm run mcp:core         # oracle-epm-core
npm run mcp:planning     # planning-ops
npm run mcp:fccs         # fccs-close
npm run mcp:hfm          # hfm (consolidation) — MCP server + fixtures exist, not yet wired into .claude/agents|skills|settings.json
npm run mcp:di           # data-integration-watchtower
npm run mcp:metadata     # metadata-governance
npm run mcp:security     # security-audit
npm run mcp:automate     # epm-automate-wrapper
```

Each script is `tsx mcp/<server>/src/index.ts`. Point a Claude Code / MCP client at these via stdio; `.claude/settings.json` allow-lists the read-only tools and gates mutating ones behind the `PreToolUse` hook.

## Architecture

Every domain follows the same three-layer call chain, thinnest at the edges:

```
mcp/<domain>/src/index.ts        MCP server: registers tools with zod input schemas, no business logic
  -> servers-as-code/src/<domain>.ts   typed business functions (the "code execution with MCP" pattern)
    -> packages/epm-core-client/src/client.ts (EpmClient)   mock/live switch, fixture reads, audit writes
```

- **MCP layer** (`mcp/*/src/index.ts`): one file per server. `registerTool(name, {title, description, inputSchema}, handler)` then wraps the result as `{ content: [{ type: "text", text: JSON.stringify(...) }] }`. No validation or safety logic lives here.
- **servers-as-code** (`servers-as-code/src/*.ts`): one module per domain (`core`, `planning-ops`, `fccs-close`, `hfm`, `data-integration`, `metadata-governance`, `security-audit`, `epm-automate`), re-exported from `index.ts`. This is where domain logic (e.g. variance thresholds, close-readiness scoring) lives, on top of `EpmClient`.
- **epm-core-client** (`packages/epm-core-client/src/`): `EpmClient` is mock-first — in mock mode every read loads a JSON fixture from `fixtures/mock-<domain>/`; in live mode every method currently throws via `liveNotImplemented()` (Basic/OAuth REST transport is a stated follow-up, not yet built). `config.ts` reads `EPM_MODE` / `EPM_DEPLOYMENT` (`cloud` | `onprem`) and picks Basic Auth (on-prem, always) vs. OAuth-or-Basic (cloud). `audit.ts` writes the append-only JSONL trail to `artifacts/audit.log`.
- **apps/claude-agent**: `orchestrator.ts` is a deterministic regex router (`routeRequest`) from free text to a `Domain`, plus a runnable mock demo — in production this role is played by the Claude Agent SDK routing to the matching subagent + skill. `policies/` holds `approval-policy.ts` (the `MUTATING_ACTIONS` list and required scope fields), `write-guard.ts` (pure function enforcing the approval packet), and `pii-redaction.ts`. `evals/*.eval.ts` are vitest suites, one per domain plus `destructive-action.eval.ts`, asserting the safety/routing contracts.
- **.claude/**: `agents/*.md` (subagent definitions), `skills/*/SKILL.md`, `hooks/pre-write-guard.mjs`, `settings.json` (permission allow/ask lists + the `PreToolUse` hook wiring). This is what a Claude Code session running in this repo actually loads.
- **fixtures/mock-<domain>/*.json**: the only data source in mock mode. Add new mock scenarios here, not in code.
- **claude-skills-catalogue/**: an unrelated personal backup/export of the user's global `~/.claude/skills` (36 skills, zipped) — not part of this project's runtime, don't treat it as project architecture.

### Safety model — three enforcement layers (defense in depth)

Full detail in `docs/approval-model.md`. Every tool defaults to read-only; `*_dry_run` / `*_plan` variants are always read-only.

1. **Client contract** — `EpmClient.executeJob` / `runAutomateCommand` refuse to run without an `approvalPacketId`/`approvalPacket`, and write an audit record.
2. **Agent write-guard** (`apps/claude-agent/src/policies/write-guard.ts`) — pure function, blocks a mutating tool unless a valid, `userConfirmed: true` packet with complete scope is present. Base scope is `environment, application`; data/journal mutations (`clear_data|copy_data|journal|import_data|import_supplemental|refresh_cube|run_business_rule|run_ruleset`) additionally require `cube, scenario, version, period, entity`.
3. **Claude Code `PreToolUse` hook** (`.claude/hooks/pre-write-guard.mjs`) — deterministic, independent of model judgment; matches tool names via the regex in `.claude/settings.json`, exits 2 to block.

The `epm-safety-evaluator` agent (`.claude/agents/epm-safety-evaluator.md`) is a fourth, model-driven check that reviews every proposed write and returns `approved_for_user_confirmation` or `blocked` — it must never approve a destructive action inside an autonomous loop (journal posting, data clear/copy, metadata import, substitution variable updates, cube refresh, EPM Automate execution are all excluded from autonomous loops per `docs/approval-model.md`).

### Mock-first vs. live mode

`EPM_MODE=mock` (default) is fully functional and is what `npm test`/`npm run demo`/the MCP servers exercise today. `EPM_MODE=live` only flips `EpmClient.isMock` — every live-mode method hits `liveNotImplemented()` and throws; there is no REST transport wired yet. `EPM_DEPLOYMENT` (`cloud` default | `onprem`) and the on-prem Basic Auth / self-signed-cert handling in `client.ts` (`buildBasicAuthHeader`, `createHttpsAgent`) are scaffolded ahead of that transport work — see `docs/onprem-setup.md`.

## MCP servers

| Server | npm script | Domain |
|---|---|---|
| oracle-epm-core | `mcp:core` | Auth, jobs, files, audit |
| planning-ops | `mcp:planning` | Data exports, business rules, substitution vars |
| fccs-close | `mcp:fccs` | Close readiness, journals, IC matching |
| hfm | `mcp:hfm` | Consolidation status, IC transactions, balancing, currency conversion — read-only |
| data-integration-watchtower | `mcp:di` | Pipeline inventory, failed loads, POV locks |
| metadata-governance | `mcp:metadata` | Snapshots, diffs, dynamic-calc risk |
| security-audit | `mcp:security` | Roles, MFA gaps, stale accounts, login audit |
| epm-automate-wrapper | `mcp:automate` | Allowlisted EPM Automate commands only |

All eight servers are wired into `.claude/agents/`, `.claude/skills/`, and the allow-list in `.claude/settings.json`.

## Agents (`.claude/agents/`)

| Agent | Role |
|---|---|
| `epm-orchestrator` | Routes requests to the right domain subagent; never calls mutating tools directly |
| `planning-operator` | Data exports, business rules, substitution vars, cube refresh preflights |
| `fccs-close` | Close readiness, journal state, IC reports, data copy/clear preflights |
| `data-integration-watchtower` | Pipeline inventory, failed-load summaries, mapping exports — read-only |
| `metadata-governance` | Snapshots, drift detection, dynamic-calc risk, member impact — read-only |
| `security-audit` | Role/access reports, MFA gaps, brute-force logins, access drift — read-only |
| `hfm` | Consolidation health check, entity/balancing status, IC transactions, currency conversion — read-only, on-prem |
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
| `hfm-consolidation-readiness` | HFM (on-prem) consolidation status, balancing issues, pending IC transactions |

## Permissions (`.claude/settings.json`)

- **Auto-allowed:** all read-only tools across all eight MCP servers.
- **Ask (user confirmation):** `epm_execute_job`, `automate_run_approved_command`.
- **Hook-gated:** any tool matching `execute_job | post_journal | clear_data | copy_data | import_* | refresh_cube | update_substitution_variable | run_business_rule | automate_run`.

## POV conventions (Planning — mock fixtures)

- `Ano` (year): e.g. `FY26`
- `Periodo` (period): e.g. `Jun`
- `Cenario` (scenario): `Actual` | `Forecast` | `Budget`
- `Versao` (version): e.g. `Trabalho`
- `Filial` (entity/branch): e.g. `SP`, `RJ`

## Deployment modes / env vars

Copy `.env.example` to `.env`. Key vars: `EPM_MODE` (`mock` default | `live`), `EPM_DEPLOYMENT` (`cloud` default | `onprem`), cloud (`EPM_BASE_URL`, `EPM_IDENTITY_DOMAIN`, OAuth `EPM_OAUTH_*`), on-prem (`EPM_SERVER_HOSTNAME`, `EPM_SERVER_PORT`, `EPM_USE_HTTPS`, `EPM_VERIFY_SSL_CERT`), shared credentials (`EPM_USERNAME`, `EPM_PASSWORD`, `EPM_API_VERSION`). On-prem always uses Basic Auth; OAuth is cloud-only and recommended there because MFA breaks Basic-Auth-only flows. Credentials are never surfaced in prompts, tool results, or logs (`redactConfig`). See `docs/onprem-setup.md` for SSL/networking detail — but note live-mode REST calls aren't implemented yet regardless of deployment (see "Mock-first vs. live mode" above).

## Layout

```
packages/epm-core-client/           Mock-first EPM client, types, config, audit
servers-as-code/                    Typed business functions per domain
mcp/oracle-epm-core/                Core MCP server
mcp/planning-ops/                   Planning MCP server
mcp/fccs-close/                     FCCS close MCP server
mcp/hfm/                            HFM consolidation MCP server
mcp/data-integration-watchtower/    DI/DM MCP server
mcp/metadata-governance/            Metadata MCP server
mcp/security-audit/                 Security MCP server (read-only)
mcp/epm-automate-wrapper/           EPM Automate MCP server (allowlisted only)
apps/claude-agent/                  Orchestrator, policies, evals
.claude/                            agents/, skills/, hooks/, settings.json
fixtures/                           Mock data for all domains (mock-planning, mock-fccs, mock-hfm, mock-data-integration, mock-metadata, mock-security, mock-automate)
docs/                               api-mapping.md, approval-model.md, onprem-setup.md, demo-prompts.md
artifacts/                          Runtime output: audit.log (JSONL), exports/ (mock export files)
claude-skills-catalogue/            Unrelated personal skills backup — not part of this project
```
