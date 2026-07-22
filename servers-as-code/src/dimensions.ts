/**
 * Read-only member lookup over the SQLite dimension database built by
 * `scripts/build-dimension-db.ts` from the Planning metadata exports.
 *
 * Purpose: let an agent resolve real member names/aliases before composing an
 * Essbase MDX query (see `planning-ops.exportDataSlice`). Uses Node's built-in
 * `node:sqlite` — no native dependency.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// servers-as-code/src -> repo root
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function dbPath(): string {
  return process.env.EPM_DIMENSION_DB || resolve(REPO_ROOT, "artifacts", "dimensions.db");
}

let cached: DatabaseSync | undefined;
function db(): DatabaseSync {
  if (cached) return cached;
  const path = dbPath();
  if (!existsSync(path)) {
    throw new Error(
      `Dimension DB not found at ${path}. Build it first: npx tsx scripts/build-dimension-db.ts`
    );
  }
  cached = new DatabaseSync(path, { readOnly: true });
  return cached;
}

/** Closes the cached DB handle (a no-op if never opened). */
export function close(): void {
  cached?.close();
  cached = undefined;
}

export interface MemberSummary {
  dimension: string;
  member: string;
  parent: string | null;
  alias: string | null;
  dataStorage: string | null;
}

export interface DimensionSummary {
  dimension: string;
  members: number;
}

/** Lists dimensions and their member counts. */
export function listDimensions(): DimensionSummary[] {
  return db()
    .prepare("SELECT dimension, COUNT(*) AS members FROM members GROUP BY dimension ORDER BY dimension")
    .all() as unknown as DimensionSummary[];
}

/**
 * Searches members by name, alias, or description (case-insensitive substring).
 * Returns a bounded envelope: total match count plus the first `limit` hits,
 * exact-name matches first.
 */
export function findMembers(args: {
  query: string;
  dimension?: string;
  limit?: number;
}): { query: string; dimension: string | null; totalMatches: number; returned: number; members: MemberSummary[] } {
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 200);
  const like = `%${args.query}%`;
  const dimFilter = args.dimension ? "AND dimension = ?" : "";
  const params = args.dimension
    ? [like, like, like, args.dimension]
    : [like, like, like];

  const where = `(member LIKE ? OR alias LIKE ? OR description LIKE ?) ${dimFilter}`;
  const total = db()
    .prepare(`SELECT COUNT(*) AS n FROM members WHERE ${where}`)
    .get(...params) as unknown as { n: number };

  // Rank exact member matches, then prefix matches, then the rest.
  const rows = db()
    .prepare(
      `SELECT dimension, member, parent, alias, data_storage AS dataStorage
         FROM members WHERE ${where}
        ORDER BY (member = ? COLLATE NOCASE) DESC,
                 (member LIKE ? COLLATE NOCASE) DESC,
                 LENGTH(member) ASC
        LIMIT ?`
    )
    .all(...params, args.query, `${args.query}%`, limit) as unknown as MemberSummary[];

  return {
    query: args.query,
    dimension: args.dimension ?? null,
    totalMatches: total.n,
    returned: rows.length,
    members: rows,
  };
}

/**
 * Returns one member's full properties (all exported columns), its parent, and
 * its immediate children — enough to navigate the hierarchy and build MDX.
 */
export function getMember(args: {
  dimension: string;
  member: string;
}): {
  dimension: string;
  member: string;
  parent: string | null;
  alias: string | null;
  dataStorage: string | null;
  description: string | null;
  properties: Record<string, string>;
  children: string[];
} | null {
  const row = db()
    .prepare(
      `SELECT dimension, member, parent, alias, data_storage AS dataStorage, description, props
         FROM members WHERE dimension = ? AND member = ?`
    )
    .get(args.dimension, args.member) as unknown as
    | {
        dimension: string;
        member: string;
        parent: string | null;
        alias: string | null;
        dataStorage: string | null;
        description: string | null;
        props: string;
      }
    | undefined;
  if (!row) return null;

  const children = (
    db()
      .prepare("SELECT member FROM members WHERE dimension = ? AND parent = ? ORDER BY member")
      .all(args.dimension, args.member) as unknown as { member: string }[]
  ).map((r) => r.member);

  const { props, ...rest } = row;
  return {
    ...rest,
    properties: JSON.parse(props ?? "{}") as Record<string, string>,
    children,
  };
}
