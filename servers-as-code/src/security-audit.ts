import { EpmClient } from "@epm/core-client";
import type {
  AccessChange,
  GroupAssignment,
  LoginRecord,
  RoleAssignment,
  UserAccess,
} from "@epm/core-client";

const client = new EpmClient();

export async function roleAssignmentReport(): Promise<RoleAssignment[]> {
  return client.listRoleAssignments();
}

export interface UserAccessReport {
  total: number;
  active: number;
  withoutMfa: UserAccess[];
  staleLogins: UserAccess[];
}

/** User access report highlighting MFA gaps and stale accounts. */
export async function userAccessReport(args?: {
  staleDays?: number;
}): Promise<UserAccessReport> {
  const staleDays = args?.staleDays ?? 90;
  const users = await client.listUserAccess();
  const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  return {
    total: users.length,
    active: users.filter((u) => u.active).length,
    withoutMfa: users.filter((u) => u.active && !u.mfaEnabled),
    staleLogins: users.filter(
      (u) => u.active && new Date(u.lastLogin).getTime() < cutoff
    ),
  };
}

export interface InvalidLoginReport {
  totalFailed: number;
  byIp: { ip: string; count: number; users: string[] }[];
  bruteForceSuspects: { ip: string; count: number }[];
}

/** Failed-login report clustered by source IP with brute-force flagging. */
export async function invalidLoginReport(args?: {
  bruteForceThreshold?: number;
}): Promise<InvalidLoginReport> {
  const threshold = args?.bruteForceThreshold ?? 3;
  const records = (await client.listLoginRecords()).filter((r) => !r.success);

  const byIpMap = new Map<string, { count: number; users: Set<string> }>();
  for (const r of records) {
    const e = byIpMap.get(r.ip) ?? { count: 0, users: new Set<string>() };
    e.count += 1;
    e.users.add(r.user);
    byIpMap.set(r.ip, e);
  }

  const byIp = [...byIpMap.entries()]
    .map(([ip, e]) => ({ ip, count: e.count, users: [...e.users] }))
    .sort((a, b) => b.count - a.count);

  return {
    totalFailed: records.length,
    byIp,
    bruteForceSuspects: byIp
      .filter((e) => e.count >= threshold)
      .map((e) => ({ ip: e.ip, count: e.count })),
  };
}

export async function groupAssignmentAudit(): Promise<GroupAssignment[]> {
  return client.listGroupAssignments();
}

/** Diffs two access snapshots: granted / revoked / role-changed users. */
export async function compareAccessSnapshots(args: {
  from: string;
  to: string;
}): Promise<{ fromSnapshot: string; toSnapshot: string; changes: AccessChange[] }> {
  const [from, to] = await Promise.all([
    client.getAccessSnapshot(args.from),
    client.getAccessSnapshot(args.to),
  ]);
  const fromMap = new Map(from.assignments.map((a) => [a.user, a.role]));
  const toMap = new Map(to.assignments.map((a) => [a.user, a.role]));

  const changes: AccessChange[] = [];
  for (const [user, role] of toMap) {
    if (!fromMap.has(user)) {
      changes.push({ kind: "GRANTED", user, to: role });
    } else if (fromMap.get(user) !== role) {
      changes.push({ kind: "ROLE_CHANGED", user, from: fromMap.get(user)!, to: role });
    }
  }
  for (const [user, role] of fromMap) {
    if (!toMap.has(user)) changes.push({ kind: "REVOKED", user, from: role });
  }

  return { fromSnapshot: from.snapshotId, toSnapshot: to.snapshotId, changes };
}
