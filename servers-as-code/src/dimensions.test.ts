import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the module at a throwaway DB before importing it (dbPath() reads the
// env lazily, and the handle is only opened on first query).
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
  ins.run("Account", "TaxExp", "TotalExpenses", "Tax Expense", "store", "", JSON.stringify({ "Account Type": "expense" }));
  ins.run("Account", "TotalTaxExp", "TaxExp", "Total Tax Expense", "dynamic calc", "", "{}");
  ins.run("Account", "TaxExpCalc", "TaxExp", "", "dynamic calc", "computed tax", "{}");
  ins.run("Currency", "USD", "Currency", "", "store", "", "{}");
  db.close();
});

afterAll(async () => {
  const { close } = await import("./dimensions.js");
  close(); // release the SQLite handle so Windows can delete the file
  rmSync(dir, { recursive: true, force: true });
});

describe("dimension member lookup", () => {
  it("listDimensions returns per-dimension counts", async () => {
    const { listDimensions } = await import("./dimensions.js");
    expect(listDimensions()).toEqual([
      { dimension: "Account", members: 3 },
      { dimension: "Currency", members: 1 },
    ]);
  });

  it("findMembers matches name/alias/description and ranks exact matches first", async () => {
    const { findMembers } = await import("./dimensions.js");
    const res = findMembers({ query: "TaxExp", dimension: "Account" });
    expect(res.totalMatches).toBe(3);
    // exact member match "TaxExp" ranks ahead of the longer partial matches
    expect(res.members[0]?.member).toBe("TaxExp");
    expect(res.members.map((m) => m.member).sort()).toEqual(["TaxExp", "TaxExpCalc", "TotalTaxExp"]);
  });

  it("findMembers also hits the description text", async () => {
    const { findMembers } = await import("./dimensions.js");
    const res = findMembers({ query: "computed", dimension: "Account" });
    expect(res.members.map((m) => m.member)).toEqual(["TaxExpCalc"]);
  });

  it("getMember returns parent, children, and parsed properties", async () => {
    const { getMember } = await import("./dimensions.js");
    const m = getMember({ dimension: "Account", member: "TaxExp" });
    expect(m?.parent).toBe("TotalExpenses");
    expect(m?.alias).toBe("Tax Expense");
    expect(m?.children.sort()).toEqual(["TaxExpCalc", "TotalTaxExp"]);
    expect(m?.properties["Account Type"]).toBe("expense");
  });

  it("getMember returns null for an unknown member", async () => {
    const { getMember } = await import("./dimensions.js");
    expect(getMember({ dimension: "Account", member: "Nope" })).toBeNull();
  });
});

describe("buildMdx (member lookup -> export bridge)", () => {
  it("reproduces the proven CORPRPT query from resolved members", async () => {
    const { buildMdx } = await import("./planning-ops.js");
    expect(
      buildMdx({
        columns: ["TotalNetPricing"],
        rows: ["TotalDivisions"],
        pov: ["FY25", "Actual", "MgmtRestated", "Per01", "USD"],
      })
    ).toBe(
      "SELECT {TotalNetPricing} ON COLUMNS, {TotalDivisions} ON ROWS " +
        "WHERE (CrossJoin(CrossJoin(CrossJoin(CrossJoin({FY25}, {Actual}), {MgmtRestated}), {Per01}), {USD}))"
    );
  });

  it("omits the WHERE clause when no POV is given", async () => {
    const { buildMdx } = await import("./planning-ops.js");
    expect(buildMdx({ columns: ["A", "B"], rows: ["X"] })).toBe(
      "SELECT {A, B} ON COLUMNS, {X} ON ROWS"
    );
  });
});
