import { describe, it, expect } from "vitest";
import { dataIntegration } from "@epm/servers-as-code";

describe("data integration watchtower (read-only)", () => {
  it("schedule inventory resolves integration names", async () => {
    const inv = await dataIntegration.scheduleInventory();
    expect(inv.length).toBeGreaterThan(0);
    const nightly = inv.find((p) => p.pipelineId === "PL_NIGHTLY");
    expect(nightly?.integrationNames).toContain("GL Actuals");
    expect(nightly?.schedule).toBe("0 2 * * *");
  });

  it("failed load summary clusters rejection reasons", async () => {
    const s = await dataIntegration.failedLoadSummary();
    expect(s.failed).toBe(1);
    expect(s.completedWithErrors).toBe(1);
    expect(s.totalRowsRejected).toBeGreaterThan(0);
    // Row-specific values/digits normalize out, but dimension name is kept,
    // so the two unmapped-member rows (Entity vs Account) stay distinct.
    const unmapped = s.byReason.filter((r) => /Unmapped member/i.test(r.reason));
    expect(unmapped.length).toBe(2);
    expect(unmapped.every((r) => r.count === 1)).toBe(true);
  });

  it("diagnose failures surfaces POV lock blockers", async () => {
    const d = await dataIntegration.diagnoseFailures();
    expect(d.lockedBlockers.length).toBeGreaterThan(0);
    expect(d.lockedBlockers.every((l) => l.locked)).toBe(true);
  });

  it("export mapping returns rules for the integration", async () => {
    const m = await dataIntegration.exportMapping("INT_GL_ACTUALS");
    expect(m.length).toBe(1);
    expect(m[0]?.rules.length).toBeGreaterThan(0);
  });
});
