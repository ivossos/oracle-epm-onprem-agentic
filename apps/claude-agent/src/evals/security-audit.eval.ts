import { describe, it, expect } from "vitest";
import { security } from "@epm/servers-as-code";

describe("security audit (read-only)", () => {
  it("user access report flags MFA gaps and stale accounts", async () => {
    const r = await security.userAccessReport({ staleDays: 90 });
    expect(r.total).toBeGreaterThan(0);
    // svc_integration + danilo.f + ex.contractor lack MFA.
    expect(r.withoutMfa.some((u) => u.user === "svc_integration")).toBe(true);
    // ex.contractor last logged in Jan 2026 (> 90d before Jul fixture data).
    expect(r.staleLogins.some((u) => u.user === "ex.contractor")).toBe(true);
  });

  it("invalid login report clusters by IP and flags brute-force", async () => {
    const r = await security.invalidLoginReport({ bruteForceThreshold: 3 });
    expect(r.totalFailed).toBeGreaterThan(0);
    const suspect = r.bruteForceSuspects.find((s) => s.ip === "45.9.148.22");
    expect(suspect).toBeDefined();
    expect(suspect!.count).toBeGreaterThanOrEqual(3);
  });

  it("compare access snapshots detects granted access", async () => {
    const d = await security.compareAccessSnapshots({
      from: "baseline",
      to: "current",
    });
    const granted = d.changes.filter((c) => c.kind === "GRANTED").map((c) => c.user);
    expect(granted).toContain("svc_integration");
    expect(granted).toContain("ex.contractor");
  });

  it("role assignment report returns assignments", async () => {
    const rows = await security.roleAssignmentReport();
    expect(rows.some((r) => r.role === "Service Administrator")).toBe(true);
  });
});
