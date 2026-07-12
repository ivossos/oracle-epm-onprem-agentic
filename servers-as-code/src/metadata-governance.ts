import { EpmClient } from "@epm/core-client";
import type {
  MetadataChange,
  MetadataDiffResult,
  MetadataMember,
  MetadataRisk,
  MetadataSnapshot,
} from "@epm/core-client";

const client = new EpmClient();

export async function exportSnapshot(which: string): Promise<MetadataSnapshot> {
  return client.getMetadataSnapshot(which);
}

function key(m: MetadataMember): string {
  return `${m.dimension}::${m.name}`;
}

const COMPARED_FIELDS: (keyof MetadataMember)[] = [
  "parent",
  "dataStorage",
  "formula",
  "solveOrder",
];

/** Diffs two metadata snapshots (added / removed / changed members). */
export async function compareSnapshots(args: {
  from: string;
  to: string;
}): Promise<MetadataDiffResult> {
  const [from, to] = await Promise.all([
    client.getMetadataSnapshot(args.from),
    client.getMetadataSnapshot(args.to),
  ]);

  const fromMap = new Map(from.members.map((m) => [key(m), m]));
  const toMap = new Map(to.members.map((m) => [key(m), m]));

  const changes: MetadataChange[] = [];

  for (const [k, m] of toMap) {
    if (!fromMap.has(k)) {
      changes.push({ kind: "ADDED", dimension: m.dimension, member: m.name });
    }
  }
  for (const [k, m] of fromMap) {
    if (!toMap.has(k)) {
      changes.push({ kind: "REMOVED", dimension: m.dimension, member: m.name });
      continue;
    }
    const cur = toMap.get(k)!;
    const fields = COMPARED_FIELDS.flatMap((f) => {
      const a = m[f] ?? null;
      const b = cur[f] ?? null;
      return a === b ? [] : [{ field: f as string, from: a, to: b }];
    });
    if (fields.length > 0) {
      changes.push({
        kind: "CHANGED",
        dimension: m.dimension,
        member: m.name,
        fields,
      });
    }
  }

  return {
    fromSnapshot: from.snapshotId,
    toSnapshot: to.snapshotId,
    added: changes.filter((c) => c.kind === "ADDED").length,
    removed: changes.filter((c) => c.kind === "REMOVED").length,
    changed: changes.filter((c) => c.kind === "CHANGED").length,
    changes,
  };
}

/** Scans a snapshot for known metadata anti-patterns that hurt refresh,
 *  consolidation, and retrieval performance. */
export async function findRisks(which: string): Promise<MetadataRisk[]> {
  const snap = await client.getMetadataSnapshot(which);
  const risks: MetadataRisk[] = [];

  // Precompute which members are referenced as a parent (have children).
  const parents = new Set(
    snap.members.map((m) => m.parent).filter((p): p is string => !!p)
  );

  for (const m of snap.members) {
    // Dynamic Calc member with a formula but no solve order.
    if (
      m.dataStorage === "Dynamic Calc" &&
      m.formula &&
      (m.solveOrder === null || m.solveOrder === undefined)
    ) {
      risks.push({
        dimension: m.dimension,
        member: m.name,
        severity: "ERROR",
        kind: "DYNAMIC_CALC_NO_SOLVE_ORDER",
        message: `Dynamic Calc member '${m.name}' has a formula but no solve order — consolidation/retrieval order is undefined.`,
      });
    }
    // Stored member carrying a formula (should usually be Dynamic Calc).
    if (m.dataStorage === "Stored" && m.formula) {
      risks.push({
        dimension: m.dimension,
        member: m.name,
        severity: "WARNING",
        kind: "STORED_WITH_FORMULA",
        message: `Stored member '${m.name}' has a formula; consider Dynamic Calc to avoid stale stored values.`,
      });
    }
    // Orphan: a stored leaf (no children) that explicitly holds no data.
    // hasData is only flagged false when the source confirms it; absent/true
    // members are never flagged, avoiding false positives on base inputs.
    if (
      m.dataStorage === "Stored" &&
      !m.formula &&
      !parents.has(m.name) &&
      m.hasData === false
    ) {
      risks.push({
        dimension: m.dimension,
        member: m.name,
        severity: "WARNING",
        kind: "ORPHAN",
        message: `Member '${m.name}' is a stored leaf with no formula and no children — possible orphan inflating the outline.`,
      });
    }
  }
  return risks;
}

export interface ImpactAnalysis {
  member: string;
  dimension: string;
  exists: boolean;
  descendants: string[];
  referencingFormulas: { member: string; formula: string }[];
}

/** Impact analysis for a member: descendants + members whose formula names it. */
export async function memberImpactAnalysis(args: {
  which: string;
  dimension: string;
  member: string;
}): Promise<ImpactAnalysis> {
  const snap = await client.getMetadataSnapshot(args.which);
  const target = snap.members.find(
    (m) => m.dimension === args.dimension && m.name === args.member
  );

  const descendants: string[] = [];
  const queue = [args.member];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const m of snap.members) {
      if (m.parent === cur) {
        descendants.push(m.name);
        queue.push(m.name);
      }
    }
  }

  const referencingFormulas = snap.members
    .filter(
      (m) =>
        m.formula &&
        new RegExp(`\\b${escapeRegExp(args.member)}\\b`).test(m.formula)
    )
    .map((m) => ({ member: m.name, formula: m.formula! }));

  return {
    member: args.member,
    dimension: args.dimension,
    exists: !!target,
    descendants,
    referencingFormulas,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
