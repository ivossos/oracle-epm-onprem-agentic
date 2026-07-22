import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dimdb-"));
  const dbFile = join(dir, "dimensions.db");
  process.env.EPM_DIMENSION_DB = dbFile;

  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE members (
      dimension TEXT NOT NULL, member TEXT NOT NULL, parent TEXT,
      alias TEXT, data_storage TEXT, description TEXT, props TEXT,
      PRIMARY KEY (dimension, member)
    );
  `);
  const ins = db.prepare(
    "INSERT INTO members (dimension, member, parent, alias, data_storage, description, props) VALUES (?,?,?,?,?,?,?)"
  );
  ins.run("Account", "Receita", "Total", "Revenue", "store", "", "{}");
  ins.run("Account", "Margem", "Total", "Margin", "dynamic calc", "",
    JSON.stringify({ "Formula (CORPRPT)": "Receita - Despesa", "Solve Order": "10" }));
  // parent === dimension name -> treated as a root (parent null)
  ins.run("Currency", "USD", "Currency", "", "store", "", "{}");
  ins.run("Year", "FY25", "", "", "", "", "{}");
  db.close();
});

afterAll(async () => {
  const { closeDimensionDb } = await import("./dimension-db.js");
  closeDimensionDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.EPM_DIMENSION_DB;
});

describe("metadataSnapshotFromDb", () => {
  it("builds a snapshot with mapped storage, formula, and solve order", async () => {
    const { metadataSnapshotFromDb } = await import("./dimension-db.js");
    const snap = metadataSnapshotFromDb("CORPRPT");
    expect(snap.app).toBe("CORPRPT");
    expect(snap.snapshotId).toBe("LIVE_CORPRPT");
    expect(snap.members).toHaveLength(4);

    const margem = snap.members.find((m) => m.name === "Margem")!;
    expect(margem.dataStorage).toBe("Dynamic Calc");
    expect(margem.formula).toBe("Receita - Despesa");
    expect(margem.solveOrder).toBe(10);

    const receita = snap.members.find((m) => m.name === "Receita")!;
    expect(receita.dataStorage).toBe("Stored");
    expect(receita.formula).toBeNull();
  });

  it("treats a member whose parent is the dimension name as a root", async () => {
    const { metadataSnapshotFromDb } = await import("./dimension-db.js");
    const usd = metadataSnapshotFromDb("CORPRPT").members.find((m) => m.name === "USD")!;
    expect(usd.parent).toBeNull();
  });
});

describe("dimensionOf", () => {
  it("resolves a member to its dimension, case-insensitively", async () => {
    const { dimensionOf } = await import("./dimension-db.js");
    expect(dimensionOf("USD")).toBe("Currency");
    expect(dimensionOf("fy25")).toBe("Year");
  });

  it("returns null for an unknown member", async () => {
    const { dimensionOf } = await import("./dimension-db.js");
    expect(dimensionOf("Nope")).toBeNull();
  });
});
