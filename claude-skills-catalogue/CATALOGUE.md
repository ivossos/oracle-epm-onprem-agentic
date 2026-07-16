# Claude Code Skills Catalogue

Generated 2026-07-16 from `~/.claude/skills` on this machine. 36 skills total.

## How to deploy this bundle on another machine

1. Unzip this archive.
2. Copy the `skills/` folder's contents into `~/.claude/skills/` on the target machine (user-level), or into `<project>/.claude/skills/` for a single project.
3. Restart Claude Code / start a new session so the new skills are picked up.
4. Two folders (`browser-automation`, `excel`) were symlinks to a separate `~/.agents/skills` directory on the source machine; they've been de-referenced here into real, self-contained copies so the bundle works standalone.

## Personal / self-contained skills (included in this zip)

| Folder | Name | Size | Source | Description |
|---|---|---|---|---|
| `agent-reach` | agent-reach | 20 KB | personal | MUST USE when user wants to 调研/research/搜索/search/查/找/look up anything on the internet — e.g. 全网调研 X / 帮我调研一下 X / 查一下 X / 搜搜 X / 看看大家怎么评价 X / X 上有什么讨论 / research this topic。 Also MUST USE when user mentions any platfo... |
| `assumption-audit` | assumption-audit | 5 KB | personal | Surfaces the unstated beliefs a strategy rests on, grades the evidence behind them, and pressure-tests the ones that would break the plan if wrong. |
| `audit` | audit | 6 KB | personal | Executa auditoria de segurança do Cubo Financ (Oracle EPM Planning). Busca relatório de provisionamento, compara com baseline, gera relatórios MD, JSON e DOCX, e verifica integridade dos outputs. |
| `browser-automation` | browser-automation | 2 KB | shared (symlink -> ~/.agents/skills) | Browser automation powers web testing, scraping, and AI agent interactions. The difference between a flaky script and a reliable system comes down to understanding selectors, waiting strategies, an... |
| `business-case-builder` | business-case-builder | 4 KB | personal | Builds a driver-based economic model for a decision, with NPV/IRR, sensitivities, and the conditions required for the case to hold, fully exposed. |
| `caldav-calendar` | caldav-calendar | 3 KB | personal | Sync and query CalDAV calendars (iCloud, Google, Fastmail, Nextcloud, etc.) using vdirsyncer + khal. Works on Linux. |
| `command-center` | command-center | 9138 KB | personal | Mission control dashboard for OpenClaw - real-time session monitoring, LLM usage tracking, cost intelligence, and system vitals. View all your AI agents in one place. |
| `competitive-intel` | competitive-intel | 5 KB | personal | Models rival capabilities and structural incentives to predict competitors' most likely next moves, and pre-commits your response before they act. |
| `customer-segmentation` | customer-segmentation | 5 KB | personal | Builds needs-based, mutually exclusive customer segments scored on attractiveness and right-to-win, so strategy can be built around the one or two that matter. |
| `decision-memo` | decision-memo | 4 KB | personal | Converts finished analysis into a one-page, answer-first decision memo that states the recommendation, the rationale, and the exact approval being requested. |
| `deploy-verify` | deploy-verify | 4 KB | personal | Deploy the EPM Copilot app (frontend + backend) to Cloud Run / OCI and verify the full login flow end-to-end before declaring success. Use when the user says "deploy", "redeploy", "ship to PROD/DEV", "login is broken ... |
| `docs-sync` | docs-sync | 2 KB | personal | Document the changes just made in this session, then stage, commit, and push the project's git repo. Use when the user says "update the docs and commit", "docs-sync", "document this and push", or after finishing a chu... |
| `epm-data-integration` | epm-data-integration | 1 KB | personal | Query and integrate Oracle EPM (Planning) data. Supports pulling financial data, running analysis, and generating reports from Oracle Planning REST API. |
| `excel` | excel | 3 KB | shared (symlink -> ~/.agents/skills) | Use when you need to work with Excel files from Clawdbot, including reading, writing, analyzing data, creating charts, and manipulating spreadsheets. |
| `find-skills` | find-skills | 4 KB | personal | Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be use... |
| `gog` | gog | 1 KB | personal | Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs. |
| `growth-barriers` | growth-barriers | 5 KB | personal | Decomposes stalled growth arithmetically and through the funnel to isolate the single binding constraint, rather than treating the loudest symptom as the cause. |
| `initiative-prioritizer` | initiative-prioritizer | 5 KB | personal | Cuts a long, competing initiative list down to the few the organization can actually execute, sequenced by dependency and capacity, with an explicit kill list. |
| `kpi-architect` | kpi-architect | 5 KB | personal | Designs a metrics system linking one north-star outcome down through a MECE driver tree to operational KPIs, with action thresholds and proxy-failure checks. |
| `market-mapping` | market-mapping | 5 KB | personal | Sizes a market by triangulating top-down and bottom-up estimates and maps demand against supply quality to locate attractive, under-served white space. |
| `narrative-builder` | narrative-builder | 5 KB | personal | Structures a recommendation as a governing-thought-first story with evidenced supporting arguments, multiple delivery lengths, and pre-answered hostile questions. |
| `operating-model-design` | operating-model-design | 5 KB | personal | Translates a chosen strategy into the specific capabilities, org structure, decision rights, and process hand-offs required to actually deliver it. |
| `playwright-mcp` | playwright-mcp | 7 KB | personal | Browser automation via Playwright MCP server. Navigate websites, click elements, fill forms, extract data, take screenshots, and perform full browser automation workflows. |
| `portfolio-review` | portfolio-review | 5 KB | personal | Reallocates capital and management attention across a portfolio of business units or bets using a nine-box attractiveness view cross-checked against actual capital consumption. |
| `pricing-strategy` | pricing-strategy | 5 KB | personal | Diagnoses whether a pricing problem is a value-communication, structure, or discipline issue, and produces a sequenced pricing action plan anchored in willingness-to-pay data. |
| `profit-pool-analysis` | profit-pool-analysis | 5 KB | personal | Maps revenue and margin at every stage of the value chain to reveal where profit actually concentrates, and where it is migrating to next. |
| `risk-mitigation` | risk-mitigation | 5 KB | personal | Builds a scoped, ranked risk register for a specific strategy with a named owner, mitigation, and leading indicator for every top risk, not a generic checklist. |
| `self-improving-agent` | self-improvement | 53 KB | personal | Captures learnings, errors, and corrections to enable continuous improvement. Use when: (1) A command or operation fails unexpectedly, (2) User corrects Claude ('No, that's wrong...', 'Actually...'), (3) User requests... |
| `situation-assessment` | situation-assessment | 5 KB | personal | Builds a fact-based baseline of where the business actually stands, structured around one decision question, with facts, inferences, and unknowns clearly separated. |
| `stakeholder-alignment` | stakeholder-alignment | 6 KB | personal | Maps every stakeholder whose support a decision needs by influence and interest, and designs a sequenced pre-wiring plan to convert swing votes before the formal decision meeting. |
| `strategic-options` | strategic-options | 5 KB | personal | Generates a genuine set of alternatives across time horizons, scores them against explicit weighted criteria, and reasons to a conditional recommendation instead of advocating a single pre-chosen answer. |
| `transformation-roadmap` | transformation-roadmap | 5 KB | personal | Sequences a prioritized initiative set into phased execution with named owners, milestones, and a concretely detailed first 90 days. |
| `value-realization` | value-realization | 5 KB | personal | Tracks every benefit a business case promised through a value ledger with owners and measurement dates, and gates further funding on value actually being proven. |
| `war-gaming` | war-gaming | 6 KB | personal | Runs a structured, multi-role simulation of a strategy against realistic competitor, customer, and regulator reactions to surface failure modes and pre-commit responses before launch. |
| `workos` | workos | 243 KB | personal | Use when the user asks for a WorkOS docs URL, term, or dashboard field (Sign-in endpoint, initiate_login_uri, Redirect URI, `WORKOS_*` env vars), or is implementing, debugging, or migrating WorkOS — AuthKit, SSO/SAML,... |
| `workos-widgets` | workos-widgets | 395 KB | personal | Use when the user is implementing, embedding, or debugging a WorkOS Widget — specifically the User Management, User Profile, Admin Portal SSO Connection, or Admin Portal Domain Verification widgets. Handles the full s... |

## Plugin-provided skills (NOT included in this zip)

These are managed by the Claude Code plugin/marketplace system on the source machine, not plain folders — copying their cache directories directly is not the supported way to move them, since plugins can also bundle commands, agents, and hooks beyond the skill itself. To get them on another machine, install the plugin there instead:

| Plugin | Skill(s) | Description | Reinstall command |
|---|---|---|---|
| `playground` | playground | Creates interactive HTML playgrounds — self-contained single-file explorers with live-preview controls. | `/plugin marketplace add claude-plugins-official` then `/plugin install playground@claude-plugins-official` |
| `frontend-design` | frontend-design | Creates distinctive, production-grade frontend interfaces avoiding generic AI aesthetics. | `/plugin install frontend-design@claude-plugins-official` |
| `agent-sdk-dev` | new-sdk-app (+ 2 verifier agents) | Creates and sets up a new Claude Agent SDK application; verifies Python/TS Agent SDK apps. | `/plugin install agent-sdk-dev@claude-plugins-official` |
| `telegram` (project-scoped) | access, configure | Telegram integration setup/config skills, scoped to the Downloads/System project on the source machine. | `/plugin install telegram@claude-plugins-official` |
| `github` | (commands/agents, no skill) | GitHub integration — included for completeness; provides no SKILL.md. | `/plugin install github@claude-plugins-official` |

## Notes

- Scanned for credential-shaped strings (API keys, private key headers, OAuth tokens) before packaging — none found. The `workos`/`workos-widgets` skills are large because they bundle full framework-specific reference docs, not credentials.
- `.DS_Store` files were excluded from the archive.
- Some skills (`epm-data-integration`, `audit`, `deploy-verify`, `docs-sync`) are specific to this user's Oracle EPM projects and reference local file paths (e.g. `security_audit.py`) that won't exist on a fresh machine — they'll need path edits to be useful elsewhere, but are included as-is for reference.