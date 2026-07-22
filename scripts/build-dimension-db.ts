/**
 * Builds a SQLite member-lookup database from Planning dimension metadata
 * exports (the `*_ExportedMetadata_<Dimension>.csv` files).
 *
 * Uses Node's built-in `node:sqlite` (Node 22.5+/24) — no native module to
 * compile. Source CSVs are read from a directory (default: the user's
 * Downloads); the DB is written to the gitignored `artifacts/` so real client
 * metadata never lands in git.
 *
 * Usage:
 *   tsx scripts/build-dimension-db.ts [srcDir] [outDb]
 *   EPM_DIMENSION_SRC=/path/to/csvs tsx scripts/build-dimension-db.ts
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { EpmClient } from "@epm/core-client";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const srcDir =
  process.argv[2] || process.env.EPM_DIMENSION_SRC || join(homedir(), "Downloads");
const outDb =
  process.argv[3] || process.env.EPM_DIMENSION_DB || join(REPO_ROOT, "artifacts", "dimensions.db");

/** RFC-4180 CSV parse: handles quoted fields, embedded commas, doubled quotes, CRLF, BOM. */
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const files = readdirSync(srcDir).filter((f) => /ExportedMetadata_.+\.csv$/i.test(f));
if (files.length === 0) {
  console.error(`No *ExportedMetadata_*.csv files found in ${srcDir}`);
  process.exit(1);
}

mkdirSync(dirname(outDb), { recursive: true });
const db = new DatabaseSync(outDb);
db.exec(`
  DROP TABLE IF EXISTS members;
  CREATE TABLE members (
    dimension     TEXT NOT NULL,
    member        TEXT NOT NULL,
    parent        TEXT,
    alias         TEXT,
    data_storage  TEXT,
    description   TEXT,
    props         TEXT,
    PRIMARY KEY (dimension, member)
  );
  CREATE INDEX idx_members_member     ON members(member COLLATE NOCASE);
  CREATE INDEX idx_members_alias      ON members(alias COLLATE NOCASE);
  CREATE INDEX idx_members_dim_parent ON members(dimension, parent);
`);

const insert = db.prepare(
  `INSERT OR IGNORE INTO members
     (dimension, member, parent, alias, data_storage, description, props)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

let totalInserted = 0;
let totalSkipped = 0;
const perDim: { dimension: string; rows: number; skipped: number }[] = [];

db.exec("BEGIN");
for (const file of files) {
  const rows = parseCsv(readFileSync(join(srcDir, file), "utf8")).filter((r) => r.some((v) => v !== ""));
  if (rows.length < 2) continue;
  const header = rows[0]!.map((h) => h.trim());
  const dimension = header[0]!; // first column header is the dimension name
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iParent = idx("Parent");
  const iAlias = idx("Alias: Default");
  const iStorage = idx("Data Storage");
  const iDesc = idx("Description");

  let inserted = 0;
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const member = (r[0] ?? "").trim();
    if (!member) continue;
    const props: Record<string, string> = {};
    header.forEach((h, i) => { if (h) props[h] = r[i] ?? ""; });
    const res = insert.run(
      dimension,
      member,
      iParent >= 0 ? r[iParent] ?? null : null,
      iAlias >= 0 ? r[iAlias] ?? null : null,
      iStorage >= 0 ? r[iStorage] ?? null : null,
      iDesc >= 0 ? r[iDesc] ?? null : null,
      JSON.stringify(props)
    );
    if (res.changes === 1) inserted++;
    else skipped++; // duplicate (dimension, member) — e.g. a shared member
  }
  perDim.push({ dimension, rows: inserted, skipped });
  totalInserted += inserted;
  totalSkipped += skipped;
}
db.exec("COMMIT");

// --- Augment: pull any cube dimensions missing from the CSV exports (e.g.
// Year, Period) live from Essbase, so the cache DB covers the whole outline.
// Data slices still come from Essbase at query time; this DB is only the
// metadata cache used to build/validate those queries. ---
const loadedDims = new Set(perDim.map((d) => d.dimension));
const liveReady =
  process.env.EPM_MODE === "live" &&
  process.env.EPM_DEPLOYMENT === "onprem" &&
  !!process.env.EPM_USERNAME &&
  !!process.env.EPM_PASSWORD;

if (liveReady) {
  const app = process.env.EPM_APP || "CORPRPT";
  const cube = process.env.EPM_CUBE || app;
  try {
    const client = new EpmClient();
    const dims = await client.listEssbaseDimensions(app, cube);
    console.log(`Essbase dimensions (${app}/${cube}): ${dims.map((d) => d.name).join(", ")}`);
    const missing = dims.filter((d) => !loadedDims.has(d.name));
    if (missing.length) {
      console.log(`Augmenting from Essbase (not in CSVs): ${missing.map((d) => d.name).join(", ")}`);
    }
    for (const d of missing) {
      const members = await client.listDimensionMembers(app, cube, d.name);
      db.exec("BEGIN");
      let n = 0;
      for (const m of members) {
        if (insert.run(d.name, m, null, null, null, null, "{}").changes === 1) n++;
      }
      db.exec("COMMIT");
      perDim.push({ dimension: d.name, rows: n, skipped: members.length - n });
      totalInserted += n;
    }
  } catch (e) {
    console.warn(`Essbase augmentation skipped: ${(e as Error).message}`);
  }
} else {
  console.log(
    "Essbase augmentation skipped — set EPM_MODE=live + on-prem creds to include cube-only dimensions (Year, Period)."
  );
}

db.close();

console.log(`Built ${outDb}`);
console.table(perDim);
console.log(`Total members: ${totalInserted}` + (totalSkipped ? `  (skipped ${totalSkipped} shared/duplicate rows)` : ""));
