import { describe, it, expect } from "vitest";
import { metadata } from "@epm/servers-as-code";

describe("metadata governance (read-only)", () => {
  it("compare snapshots detects add / remove / change", async () => {
    const d = await metadata.compareSnapshots({ from: "baseline", to: "current" });
    // Added: MargemPct, ContaAntiga (Account) + MG (Entity).
    expect(d.added).toBeGreaterThanOrEqual(3);
    // Removed: RJ (Entity).
    const removedRj = d.changes.find(
      (c) => c.kind === "REMOVED" && c.member === "RJ"
    );
    expect(removedRj).toBeDefined();
    // Changed: Margem lost its solve order.
    const margem = d.changes.find(
      (c) => c.kind === "CHANGED" && c.member === "Margem"
    );
    expect(margem?.fields?.some((f) => f.field === "solveOrder")).toBe(true);
  });

  it("find risks flags dynamic-calc-no-solve-order, stored-with-formula, orphan", async () => {
    const risks = await metadata.findRisks("current");
    const kinds = new Set(risks.map((r) => r.kind));
    expect(kinds.has("DYNAMIC_CALC_NO_SOLVE_ORDER")).toBe(true); // Margem
    expect(kinds.has("STORED_WITH_FORMULA")).toBe(true); // MargemPct
    expect(kinds.has("ORPHAN")).toBe(true); // ContaAntiga
  });

  it("member impact analysis finds formula references", async () => {
    const impact = await metadata.memberImpactAnalysis({
      which: "current",
      dimension: "Account",
      member: "Margem",
    });
    expect(impact.exists).toBe(true);
    // MargemPct formula references Margem.
    expect(
      impact.referencingFormulas.some((f) => f.member === "MargemPct")
    ).toBe(true);
  });

  it("impact analysis reports descendants of a parent", async () => {
    const impact = await metadata.memberImpactAnalysis({
      which: "current",
      dimension: "Entity",
      member: "Brasil",
    });
    expect(impact.descendants).toContain("SP");
    expect(impact.descendants).toContain("MG");
  });
});
