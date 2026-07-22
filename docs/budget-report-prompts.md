# CORPRPT budget report prompts (best-practice, actionable)

Paste into the chat gateway (http://localhost:8000/) or Claude Desktop. Each prompt
drives the live tools (`planning_find_members` → `planning_build_mdx` →
`planning_export_data_slice`) and asks for analysis, not a data dump.

**Known facts baked in (from the live cube):**
- Budget = Scenario **`Plan`**; Actual = Scenario **`Actual`**.
- Primary budget version **`Base`**; use **`Mgmt`** when you need one version that
  carries *both* Plan and Actual for NetIncome (Actual NetIncome is #Missing on `Base`).
- Data exists only in **FY24 (all 12 periods) and FY25**. FY26/FY27 are empty.
- Confirm cells with **`NetIncome` @ `TotalDivisions`** (USD). `TotalNetPricing` /
  `TotalExpenses` are #Missing at that rollup — source them at lower Division levels.

**Reporting best practices these prompts enforce:** state the POV explicitly; show the
MDX for auditability; quantify variance in both $ and %; label favorable/unfavorable;
rank/prioritize movers; flag #Missing instead of dropping it; end with concrete actions.

---

## 1. Budget vs Actual variance (FY24, monthly)

```
Produce a FY24 Budget-vs-Actual variance report for CORPRPT. Budget = Scenario Plan,
Actual = Scenario Actual; use a Version that carries both for NetIncome (Mgmt), at
Division TotalDivisions, Currency USD, Account NetIncome, periods Per01–Per12. Show the
MDX you used. Return a table: Period | Budget | Actual | Variance $ | Variance % |
Favorable/Unfavorable. Then give a 3-bullet executive summary, the 3 largest unfavorable
months with hypotheses to investigate, and recommended next actions. Treat #Missing as
"no data" and call it out rather than dropping the row.
```

## 2. Division driver / contribution analysis (FY24 budget)

```
For CORPRPT FY24 budget (Scenario Plan, Version Base, Per01, USD, Account NetIncome):
resolve the Division members under TotalDivisions, pull NetIncome for each, and rank them
by contribution. Show value and % of total per division, flag any negative or outsized
(>20% of total) divisions, and give a concentration read (is the result driven by a few
divisions?). End with 3 actionable follow-ups. Show the resolved member list and the MDX.
```

## 3. Monthly trend & full-year pacing (FY24 Plan/Base)

```
Build a FY24 budget run-rate view for CORPRPT: Scenario Plan, Version Base, Account
NetIncome, Division TotalDivisions, USD, Per01–Per12. Return monthly values, cumulative
YTD, and month-over-month change. Identify the trend, any seasonality or inflection
points, and whether the full year is pacing above or below a straight-line run-rate.
Close with 3 insights and 2 actions. Show the MDX.
```

## 4. FY24 → FY25 budget YoY

```
Compare CORPRPT budget between FY24 and FY25 (Scenario Plan, Version Base, Account
NetIncome, Division TotalDivisions, USD, Per01). Show both values, YoY $ and % change,
and interpret the trajectory. Note that FY26/FY27 carry no data. Give 2 insights and one
recommendation on which budget assumptions to revisit.
```

## 5. Budget data-readiness / coverage audit

```
Before we report, audit budget data availability for CORPRPT. For Scenario Plan, Version
Base, Account NetIncome, Division TotalDivisions, USD: check which Years (FY23–FY27) and
which Periods (Per01–Per12 in FY24) return data vs #Missing. Present a coverage matrix,
flag the gaps, and give a go/no-go data-readiness call for a FY24 budget report. Also note
which accounts (TotalNetPricing, TotalExpenses) are #Missing at TotalDivisions and where
they should be sourced instead.
```

## 6. Board-ready one-pager

```
Create a one-page CORPRPT FY24 budget executive summary (Scenario Plan, Version Base,
NetIncome, TotalDivisions, USD). Include: 3 headline KPIs (FY24 Per01 NetIncome, FY25-vs-
FY24 YoY, top-contributing division), 3 insights, 3 recommended actions, and a footnote
with the exact POV and MDX for auditability. Keep it concise and board-ready.
```

## 7. Management vs input-version reconciliation

```
For CORPRPT FY24 Plan (NetIncome, TotalDivisions, Per01, USD), compare the Base input
version against the Mgmt rollup version. Show both values and the delta, explain what the
management adjustments represent at a high level, and flag whether the gap looks
reasonable or warrants review. Show the MDX for each.
```
