# Claude Desktop — CORPRPT demo prompts

Copy-paste prompts for testing the `planning-ops` MCP server in **Claude Desktop**,
live against the on-prem CORPRPT application (`10.10.10.20:19000`).

## Setup

1. The 8 MCP servers are wired into `%APPDATA%\Claude\claude_desktop_config.json`
   with the live on-prem env (`EPM_MODE=live`, `EPM_DEPLOYMENT=onprem`).
2. Build the member-lookup DB once (reads the dimension exports from `~/Downloads`):
   ```
   npm run db:dimensions
   ```
3. **Fully restart Claude Desktop** — quit from the tray icon (not just close the
   window) and reopen, so it respawns the servers with the current tools.

Notes:
- Claude Desktop prompts you to approve each tool the first time it's called.
- Live reads go through the **Essbase** REST API (Planning REST is down on this
  server — see `onprem-corprpt-500-issue.md`).
- `#Missing` intersections come back as `null` — expected, not an error.
- The member DB covers 8 dimensions (Account, CostCenter, Country, Currency,
  Division, Entity, Scenario, Version). Year/Period aren't exported, so supply
  those POV members directly.

## Connectivity / discovery

```
What Oracle EPM applications and cubes can you see?
```

```
Show me the current substitution variables for CORPRPT and tell me which period is the current actual period.
```

## Exploring the dimensions (local member DB)

```
List all the dimensions and how many members each one has.
```

```
Search the Account dimension for anything related to "tax" and show me the top matches with their aliases.
```

```
What are the children of TotalExpenses in the Account dimension, and what's the data storage on each?
```

```
Find the member "USD" and tell me everything about it — parent, alias, and its properties.
```

```
Which Scenario members exist for actuals? Search the Scenario dimension for "actual".
```

## Building and running a live query (the tandem workflow)

`planning_find_members` → `planning_build_mdx` → `planning_export_data_slice`

```
Look up the members, build the MDX, and pull the live FY25 Actual value of
TotalNetPricing for TotalDivisions in CORPRPT (Version MgmtRestated, Period
Per01, Currency USD). Show me the MDX and the number.
```
_(Expected: TotalNetPricing ≈ 23,971,333.)_

```
I want TotalNetPricing, TotalExpenses, and NetIncome across TotalDivisions for
FY25 / Actual / MgmtRestated / Per01 / USD. Resolve the account members first,
then pull the live values and flag any that are #Missing.
```

```
Build an MDX that puts a few top-level accounts on columns and the top divisions
on rows for FY25 Actual in USD, then run it against CORPRPT and show me the grid.
```

## Analysis on top of live data

```
Pull TotalNetPricing by division for FY25 Actual / MgmtRestated / Per01 / USD,
then tell me which divisions have data and which come back empty.
```

```
Get the CORPRPT current-actual-period substitution variable, then use it as the
Period in a live query for TotalNetPricing at TotalDivisions (FY25, Actual, USD).
```

## Tools exercised

| Prompt group | Tools |
|---|---|
| Connectivity / discovery | `epm_list_applications`, `planning_get_substitution_variables` |
| Exploring dimensions | `planning_list_dimensions`, `planning_find_members`, `planning_get_member` |
| Tandem workflow | `planning_find_members`, `planning_build_mdx`, `planning_export_data_slice` |
| Analysis | all of the above, plus `planning_variance_snapshot` |
