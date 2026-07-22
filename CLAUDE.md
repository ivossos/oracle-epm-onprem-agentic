# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Anthropic-native agentic services for Oracle Cloud EPM (Planning / FCCS) and on-premises Oracle EPM 11.1.2.4+ (HFM), built on a thin, typed MCP tool layer. **Mock-first**: every demo, eval, and tool runs with zero Oracle credentials until `EPM_MODE=live` — and live mode is mostly still a stub, with on-prem Basic Auth wired for exactly two methods so far (see "Mock-first vs. live mode" below).

## Commands

```bash
npm install
npm run typecheck        # tsc -p tsconfig.json --noEmit, across the whole monorepo (no per-package tsconfig)
npm test                 # vitest run — all *.eval.ts and *.test.ts
npm run test:watch       # vitest (watch mode)
npm run evals            # vitest run apps/claude-agent/src/evals  (29 eval cases across 7 files)
npm run demo             # runnable mock orchestrator demo, no creds — tsx apps/claude-agent/src/orchestrator.ts
npm run monitor:variance # read-only actual-vs-forecast variance check, exits 1 on exceptions — tsx apps/claude-agent/src/variance-monitor.ts [app] [cube] [thresholdPct]
npm run db:dimensions    # build the member-lookup SQLite DB from Planning metadata exports — tsx scripts/build-dimension-db.ts [srcDir] [outDb]
```

`npm run db:dimensions` reads `*_ExportedMetadata_<Dimension>.csv` files (default: `~/Downloads`, or `$EPM_DIMENSION_SRC`) into `artifacts/dimensions.db` (gitignored; overridable via `$EPM_DIMENSION_DB`), then — if live on-prem creds are set — **augments from Essbase**: `GET /dimensions` lists every cube dimension and any not covered by a CSV (e.g. Year, Period, attribute dims) get their members enumerated via a dataless MDX query. Result is the full outline (18 dims for CORPRPT) as a local metadata cache. Built with Node's native `node:sqlite` — no install/compile. See "Member lookup" below.

`npm test` runs 35 tests across 8 files: the 7 eval files above (29 eval cases) plus `packages/epm-core-client/src/onprem-live.test.ts` (6 on-prem Basic Auth wiring tests, against a local HTTP stub).

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
npm run mcp:hfm          # hfm (consolidation) — read-only, on-prem
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
- **epm-core-client** (`packages/epm-core-client/src/`): `EpmClient` is mock-first — in mock mode every read loads a JSON fixture from `fixtures/mock-<domain>/`. In live mode with `EPM_DEPLOYMENT=onprem`, real Basic Auth REST calls go over two surfaces via `onpremRequest()`: `listJobDefinitions` and `executeJob` hit the **Planning** REST API (`/HyperionPlanning/rest/...`; `executeJob` posts `application/x-www-form-urlencoded`), while `listApplications`, `getSubstitutionVariables`, and `exportDataSlice` read through the **Essbase** REST v1 API (`/essbase/rest/v1/...`). The Planning REST module is down on the target server (every GET 500s — see `docs/onprem-corprpt-500-issue.md`), so the Essbase path is the working live read path: `exportDataSlice` runs a pass-through MDX query against `.../databases/{cube}/mdx` (`Accept: */*` — the endpoint 406s on `application/json`) and flattens the `{metadata,data}` grid. Every other method (and all of Cloud OAuth) still throws via `liveNotImplemented()`. `config.ts` reads `EPM_MODE` / `EPM_DEPLOYMENT` (`cloud` | `onprem`) and picks Basic Auth (on-prem, always) vs. OAuth-or-Basic (cloud). `audit.ts` writes the append-only JSONL trail to `artifacts/audit.log`.
- **Metadata cache vs. live data — the core split**: **data slices come from the live Essbase API; the metadata used to build/validate those queries comes from a local cache DB.** `scripts/build-dimension-db.ts` builds the cache (`artifacts/dimensions.db`) — a `members` table keyed by `(dimension, member)` with core columns (`parent`, `alias`, `data_storage`, `description`) plus every exported CSV column as JSON in `props`; shared/alternate-hierarchy rows dedupe to one canonical row. CSVs supply the 8 rich dimensions; Essbase augmentation fills the rest of the outline (Year, Period, attribute dims). Two readers query it via `node:sqlite`: `servers-as-code/src/dimensions.ts` (`findMembers`/`getMember`/`listDimensions`, powering the `planning_*` member tools) and `packages/epm-core-client/src/dimension-db.ts` (`metadataSnapshotFromDb` for live `getMetadataSnapshot`; `dimensionOf` for POV resolution).
- **Query-build flow**: `planning_find_members` → `planning_build_mdx` (`buildMdx({columns, rows, pov})` → left-nested-CrossJoin MDX, the proven CORPRPT form) → `planning_export_data_slice` (runs the MDX live via Essbase REST). The MDX grid only echoes axis members, so `exportDataSlice` re-stamps the fixed WHERE/POV members onto every row (`enrichSliceWithPov`, resolving each member's dimension via `dimensionOf`) — so each exported row is a full intersection ("all dimensions present"). The metadata-governance tools also read this cache live: `getMetadataSnapshot` builds a `MetadataSnapshot` from the DB, and `metadata_export_snapshot` returns a bounded per-dimension summary (full snapshot persisted to an artifact).
- **apps/claude-agent**: `orchestrator.ts` is a deterministic regex router (`routeRequest`) from free text to a `Domain`, plus a runnable mock demo — in production this role is played by the Claude Agent SDK routing to the matching subagent + skill. `variance-monitor.ts` is a standalone read-only CLI (`npm run monitor:variance`) that resolves the current POV from substitution variables, runs a variance snapshot, and exits nonzero on exceptions — meant for cron/CI. `policies/` holds `approval-policy.ts` (the `MUTATING_ACTIONS` list and required scope fields), `write-guard.ts` (pure function enforcing the approval packet), and `pii-redaction.ts`. `evals/*.eval.ts` are vitest suites, one per domain plus `destructive-action.eval.ts`, asserting the safety/routing contracts.
- **apps/chat-gateway**: a separate Python/FastAPI app (own venv, `requirements.txt`) exposing a chat UI (`static/index.html`) over an Anthropic tool-use loop wired to all 8 MCP servers via stdio (`app/mcp_pool.py`, `app/config.py`). The two mutating tools (`epm_execute_job`, `automate_run_approved_command`) pause the turn and return `status: "awaiting_approval"` until a separate `/api/approve` call confirms or denies — see `apps/chat-gateway/README.md`. This is Python and independent of the TS workspaces; it is not covered by `npm run typecheck`/`npm test`.
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

`EPM_MODE=mock` (default) is fully functional and is what `npm test`/`npm run demo`/the MCP servers exercise today. `EPM_MODE=live` flips `EpmClient.isMock`; five methods go over the wire so far, all via `onpremRequest()` (`packages/epm-core-client/src/client.ts`, a small Basic-Auth HTTP/HTTPS client) when `EPM_DEPLOYMENT=onprem` + `EPM_USERNAME`/`EPM_PASSWORD` are set, across two REST surfaces:

- **Essbase REST v1** (`/essbase/rest/v1/...`, configurable via `EPM_ESSBASE_BASE_PATH`) — `listApplications`, `getSubstitutionVariables`, `exportDataSlice`, `listEssbaseDimensions`, `listDimensionMembers`, `listBusinessRules` / `getBusinessRule` (calc scripts via `.../databases/{db}/scripts` + `/scripts/{name}/content`), `runBusinessRule` (the one **mutating** Essbase live path — `POST .../jobs` with `jobtype: "calc"` and the script name in `parameters.file`; requires an approval packet, response mapped defensively and unverified against a real server), and `getMetadataSnapshot` (the last reads the local cache DB, itself built from Essbase + CSVs). The reads here are the **verified working live path** (confirmed against the real `10.10.10.20:19000` / `CORPRPT` server): `exportDataSlice` runs a pass-through MDX query (default in `DEFAULT_MDX`) against `.../databases/{cube}/mdx` with `Accept: */*` (the endpoint 406s on `application/json`) and `parseEssbaseMdxGrid` flattens the `{metadata,data}` grid; substitution variables come from Essbase app- + database-level variables.
- **Planning REST** (`/HyperionPlanning/rest/{apiVersion}/...`) — `listJobDefinitions` (GET) and `executeJob` (POST `application/x-www-form-urlencoded`). **This surface is down on the target server** — every GET 500s despite valid auth and routing (root cause: the Planning REST module crashes pre-auth; see `docs/onprem-corprpt-500-issue.md`). That is why the reads above go through Essbase instead. `onpremRequest` surfaces the raw response body on 500 to aid diagnosis; `scripts/test_onprem_planning_connection.py` runs the discovery/diagnostic matrix.

- **FDMEE / Data Management REST** (`/aif/rest/V1/...`, configurable via `EPM_AIF_BASE_PATH`; note literal uppercase `V1`, present on 11.1.2.4.210+) — wired live:
  - `listIntegrationJobs` → `GET /aif/rest/V1/jobs` (mapped by `mapFdmeeJob`; job-level status only — no row counts/rejections over REST).
  - `listDmApplications` → `GET /aif/rest/V1/applications` (registered target apps); `listDataRules` → scans `GET /aif/rest/V1/rules?locationId=` (there is no locations-list endpoint), returning each rule's `lastJobStatus`. The scan self-tunes: parallel batches up to a ceiling `EPM_AIF_MAX_LOCATION_ID` (default 500), stopping early after `EPM_AIF_LOCATION_GAP` (default 100) consecutive empty ids past the last hit; per-id errors are tolerated. It reports `scannedThroughLocationId` / `stoppedEarly` / `scanErrors` (no silent cap). Both surface through `integrationInventory` / the `di_integration_inventory` tool.
  - `listPipelines`, `listIntegrations`, `exportMapping`, `listPovLocks` return **empty** on-prem — "pipelines" and `/aif/rest/V1/POV` are EPM Cloud-only (verified live: those paths 404). Honest-empty, not mock data.

Every other method, and all of Cloud OAuth, still throws via `liveNotImplemented()`. Self-signed-cert handling (`createHttpsAgent`, `EPM_VERIFY_SSL_CERT`) is wired but only exercised when `EPM_USE_HTTPS=true` — see `docs/onprem-setup.md`. `packages/epm-core-client/src/onprem-live.test.ts` covers both wired surfaces against a local HTTP stub, not a real server.

## MCP servers

| Server | npm script | Domain |
|---|---|---|
| oracle-epm-core | `mcp:core` | Auth, jobs, files, audit |
| planning-ops | `mcp:planning` | Data exports (Essbase MDX), variance, substitution vars, member lookup + MDX builder, business rules |
| fccs-close | `mcp:fccs` | Close readiness, journals, IC matching |
| hfm | `mcp:hfm` | Consolidation status, IC transactions, balancing, currency conversion — read-only |
| data-integration-watchtower | `mcp:di` | Pipeline inventory, failed loads, POV locks |
| metadata-governance | `mcp:metadata` | Snapshots (live from cache DB), diffs, dynamic-calc risk |
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
- **Ask (user confirmation):** `epm_execute_job`, `planning_run_business_rule`, `automate_run_approved_command`.
- **Hook-gated:** any tool matching `execute_job | post_journal | clear_data | copy_data | import_* | refresh_cube | update_substitution_variable | run_business_rule | automate_run`.

## POV conventions (Planning — mock fixtures)

- `Ano` (year): e.g. `FY26`
- `Periodo` (period): e.g. `Jun`
- `Cenario` (scenario): `Actual` | `Forecast` | `Budget`
- `Versao` (version): e.g. `Trabalho`
- `Filial` (entity/branch): e.g. `SP`, `RJ`

## Deployment modes / env vars

Copy `.env.example` to `.env`. Key vars: `EPM_MODE` (`mock` default | `live`), `EPM_DEPLOYMENT` (`cloud` default | `onprem`), cloud (`EPM_BASE_URL`, `EPM_IDENTITY_DOMAIN`, OAuth `EPM_OAUTH_*`), on-prem (`EPM_SERVER_HOSTNAME`, `EPM_SERVER_PORT`, `EPM_USE_HTTPS`, `EPM_VERIFY_SSL_CERT`), shared credentials (`EPM_USERNAME`, `EPM_PASSWORD`, `EPM_API_VERSION`). On-prem always uses Basic Auth; OAuth is cloud-only and recommended there because MFA breaks Basic-Auth-only flows. Credentials are never surfaced in prompts, tool results, or logs (`redactConfig`). See `docs/onprem-setup.md` for SSL/networking detail, and `scripts/test_onprem_planning_connection.py` for a standalone connectivity/discovery check against a real server — but note only `listJobDefinitions`/`executeJob` actually go live on-prem today; everything else still throws regardless of deployment (see "Mock-first vs. live mode" above).

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
apps/claude-agent/                  Orchestrator, variance monitor, policies, evals
apps/chat-gateway/                  Python/FastAPI chat UI over the MCP servers (separate from the TS workspaces)
.claude/                            agents/, skills/, hooks/, settings.json
fixtures/                           Mock data for all domains (mock-planning, mock-fccs, mock-hfm, mock-data-integration, mock-metadata, mock-security, mock-automate)
docs/                               api-mapping.md, approval-model.md, onprem-setup.md, demo-prompts.md, onprem-corprpt-500-issue.md
scripts/                            test_onprem_planning_connection.py (on-prem discovery), build-dimension-db.ts (member DB)
artifacts/                          Runtime output (gitignored): audit.log (JSONL), exports/, dimensions.db (member lookup)
claude-skills-catalogue/            Unrelated personal skills backup — not part of this project
```
