---
name: planning-data-slice
description: Use for Planning data exports, variance snapshots, and actual/forecast/budget comparisons. Handles POV conventions, missing-data handling, and bounded artifact output.
---

# Planning Data Slice

Use this when the user wants Planning numbers: exports, variance, or
actual-vs-forecast/budget comparisons.

## POV conventions (mock fixture)

- `Ano` (year): e.g. `FY26`
- `Periodo` (period): e.g. `Jun`
- `Cenario` (scenario): `Actual` | `Forecast` | `Budget`
- `Versao` (version): e.g. `Trabalho`
- `Filial` (entity/branch): e.g. `SP`, `RJ`

## Steps

1. `planning_get_substitution_variables` — resolve CurrentYear/CurrentMonth
   if the user says "current".
2. `planning_export_data_slice` — pull the slice. Returns a bounded envelope
   (totalRows, sample, artifactPath). The full extract stays on disk.
3. `planning_variance_snapshot` — for actual-vs-forecast, returns only the
   exceptions: missing intersections or |variance%| over threshold (default 5%).

## Missing-data handling

- A `null` value = missing intersection. Surface these explicitly; they are
  usually the point of the exercise (load gaps before forecast).

## Output

- Never dump > 50 rows inline. Return the artifact path + a sample + counts.
