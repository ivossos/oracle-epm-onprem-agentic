# Approval Model

| Document | |
| --- | --- |
| **Version** | 0.1.0 |
| **Date** | 2026-07-12 |
| **Author** | Henry (agent) for Ioannis Vossos |
| **Status** | Draft — mock-first scaffold |
| **Owner** | Ioannis Vossos |

## Change log

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.1.0 | 2026-07-12 | Henry | Initial approval model |

---

## Principle

Every tool defaults to **read-only or dry-run**. A tool that changes data,
period state, substitution variables, metadata, journals, or consolidation
status is **mutating** and requires a user-confirmed **approval packet** with
complete scope.

## Three enforcement layers (defense in depth)

1. **Client contract** — `EpmClient.executeJob` refuses without an
   `approvalPacketId` and writes an audit record.
2. **Agent write-guard** (`apps/claude-agent/src/policies/write-guard.ts`) —
   pure function; blocks a mutating tool unless a valid packet is present.
3. **Claude Code hook** (`.claude/hooks/pre-write-guard.mjs`) — deterministic
   PreToolUse block, independent of model judgment. Exit code 2 = blocked.

## Approval packet

```
{ id, environment, application, cube?, scenario?, version?, period?, entity?,
  restPayload, expectedArtifacts[], rollbackPath, residualRisk, userConfirmed }
```

- `environment` + `application` are always required.
- Data/journal mutations additionally require `cube, scenario, version,
  period, entity`.
- `userConfirmed` must be `true` — set only after the human confirms.

## Mutating action list

See `apps/claude-agent/src/policies/approval-policy.ts` (`MUTATING_ACTIONS`).
`*_dry_run` and `*_plan` variants are always treated as read-only.

## Autonomous loops

Read-only investigation and support-ticket prep may run autonomously.
Journal posting, data clear/copy, metadata import, substitution variable
updates, cube refresh, and EPM Automate execution may **never** run inside an
autonomous loop.
