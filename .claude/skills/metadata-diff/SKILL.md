---
name: metadata-diff
description: Use for metadata drift, failed cube refresh, and consolidation/retrieval performance symptoms. Covers snapshot diff rules, dynamic-calc risk checks, and FCCS seeded-member checks.
---

# Metadata Diff

Use this when the user reports drift, a failed refresh, or slow
consolidation/retrieval that points at metadata.

## Steps

1. `fccs_validate_metadata` (or planning equivalent) — get errors/warnings.
2. Classify each issue:
   - **Dynamic Calc risk**: a Dynamic Calc member referenced by a stored parent
     without a correct solve order → retrieval/consolidation slowness.
   - **Orphan**: stored member with no children and no data.
   - **IC designation**: entity used in an IC account but missing IC flag.
3. For drift, compare the current export against the last snapshot (added,
   removed, changed members).

## Anti-patterns to flag

- Stored placeholders that should be Dynamic Calc.
- Wrong solve order on formula members.
- Orphaned members inflating the outline.

## Never

- Do not import metadata from this skill. Produce a proposed import package and
  route it to the safety evaluator for an approval packet + dry-run first.
