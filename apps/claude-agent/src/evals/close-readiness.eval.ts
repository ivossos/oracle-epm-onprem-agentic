import { describe, it, expect } from "vitest";
import { fccs } from "@epm/servers-as-code";

describe("close readiness (read-only)", () => {
  it("aggregates metadata, journals, and intercompany into a go/no-go report", async () => {
    const r = await fccs.closeReadinessReport({ app: "FCCS", period: "Jun" });

    // Mock fixture has 2 metadata errors, 1 unbalanced journal, 1 IC mismatch.
    expect(r.ready).toBe(false);
    expect(r.metadata.errors).toBe(2);
    expect(r.journals.unbalanced).toBeGreaterThan(0);
    expect(r.intercompany.unmatched).toBeGreaterThan(0);

    // Must explain blockers (what failed / what to do next).
    expect(r.blockers.length).toBeGreaterThan(0);
    expect(r.blockers.join(" ")).toMatch(/metadata|unbalanced|intercompany/i);
  });

  it("filters journals by period without error", async () => {
    const js = await fccs.retrieveJournals({ period: "Jun" });
    expect(js.every((j) => j.period === "Jun")).toBe(true);
  });
});
