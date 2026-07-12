---
name: security-access-review
description: Use for EPM security and access reviews — role/access reports, MFA gaps, stale accounts, failed/brute-force logins, group audits, and access drift between two snapshots. Read-only.
---

# Security & Access Review

Use this when the user asks "who has admin", "any MFA gaps", "what access
changed", "any suspicious logins", or runs a periodic access certification.

## Steps

1. `security_role_assignment_report` — baseline of who holds which role.
2. `security_user_access_report` — flags:
   - **Service Administrator without MFA** (highest risk).
   - **Stale accounts** (no login in N days, default 90) that are still active.
3. `security_invalid_login_report` — failed logins clustered by IP; brute-force
   suspects (>= threshold failures from one IP).
4. `security_group_assignment_audit` — over-broad groups (e.g. legacy
   "all access") and their members.
5. `security_compare_access_snapshots` — granted / revoked / role-changed users
   since the last review (access drift).

## Findings → recommended action (human task)

- Privileged account without MFA → require MFA enrollment.
- Stale privileged account → disable or recertify.
- Brute-force IP → block at network edge; force password reset for targeted users.
- Legacy all-access group → decompose into least-privilege groups.

## Never

- This skill has no write tools. Report findings with concrete users/IPs; the
  remediation is performed by an administrator, not by a tool.
