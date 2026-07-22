/**
 * Reads the SQLite dimension database (built by scripts/build-dimension-db.ts
 * from the Planning metadata exports) and shapes it into the domain types.
 *
 * This is the live on-prem metadata source: the Planning REST outline API is
 * down on the target server (see docs/onprem-corprpt-500-issue.md), but the
 * exported dimensions loaded here give the same member structure. Uses Node's
 * built-in `node:sqlite` — no native dependency.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { DataStorage, MetadataMember, MetadataSnapshot } from "./types.js";

// packages/epm-core-client/src -> repo root
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function dimensionDbPath(): string {
  return process.env.EPM_DIMENSION_DB || resolve(REPO_ROOT, "artifacts", "dimensions.db");
}

let cached: DatabaseSync | undefined;

function open(): DatabaseSync {
  if (cached) return cached;
  const path = dimensionDbPath();
  if (!existsSync(path)) {
    throw new Error(
      `Dimension DB not found at ${path}. Build it first: npx tsx scripts/build-dimension-db.ts`
    );
  }
  cached = new DatabaseSync(path, { readOnly: true });
  return cached;
}

/** Closes the cached handle (a no-op if never opened). */
export function closeDimensionDb(): void {
  cached?.close();
  cached = undefined;
}

/**
 * Resolves which dimension a member name belongs to (first match, case-
 * insensitive). Best-effort: returns null if the DB is absent or the member is
 * unknown, so callers can degrade gracefully.
 */
export function dimensionOf(member: string): string | null {
  try {
    const row = open()
      .prepare("SELECT dimension FROM members WHERE member = ? COLLATE NOCASE LIMIT 1")
      .get(member) as unknown as { dimension: string } | undefined;
    return row?.dimension ?? null;
  } catch {
    return null;
  }
}

const STORAGE_MAP: Record<string, DataStorage> = {
  store: "Stored",
  stored: "Stored",
  "dynamic calc": "Dynamic Calc",
  "dynamic calc and store": "Dynamic Calc and Store",
  "never share": "Never Share",
  "label only": "Label Only",
  shared: "Shared",
};

function mapStorage(raw: string | null): DataStorage {
  return STORAGE_MAP[(raw ?? "").trim().toLowerCase()] ?? "Stored";
}

function clean(v: string | undefined): string | null {
  if (v === undefined) return null;
  const s = v.trim();
  return s === "" || s === "<none>" ? null : s;
}

interface Row {
  dimension: string;
  member: string;
  parent: string | null;
  ds: string | null;
  props: string;
}

/**
 * Builds a MetadataSnapshot from the whole dimension DB. Top-of-dimension
 * members (whose parent is the dimension name itself) are treated as roots
 * (parent = null). Formula prefers the plan-type column, then the base column.
 */
export function metadataSnapshotFromDb(app: string): MetadataSnapshot {
  const rows = open()
    .prepare(
      "SELECT dimension, member, parent, data_storage AS ds, props FROM members ORDER BY dimension, member"
    )
    .all() as unknown as Row[];

  const members: MetadataMember[] = rows.map((r) => {
    const props = JSON.parse(r.props ?? "{}") as Record<string, string>;
    const solveRaw = clean(props["Solve Order"]);
    return {
      dimension: r.dimension,
      name: r.member,
      parent: r.parent && r.parent !== r.dimension ? r.parent : null,
      dataStorage: mapStorage(r.ds),
      formula: clean(props[`Formula (${app})`]) ?? clean(props["Formula"]),
      solveOrder: solveRaw !== null ? Number(solveRaw) : null,
    };
  });

  return {
    snapshotId: `LIVE_${app}`,
    capturedAt: new Date().toISOString(),
    app,
    members,
  };
}
