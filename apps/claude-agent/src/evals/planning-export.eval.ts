import { describe, it, expect } from "vitest";
import { planning } from "@epm/servers-as-code";
import { checkOutboundPayload, INLINE_ROW_LIMIT } from "../policies/pii-redaction.js";

describe("planning export summarization (no context flooding)", () => {
  it("returns a bounded envelope with counts + sample + artifact path", async () => {
    const res = await planning.exportDataSlice({ app: "Financ", cube: "ORC_Plan" });
    expect(res).toHaveProperty("totalRows");
    expect(res).toHaveProperty("sample");
    expect(res.artifactPath).toMatch(/artifacts\/exports\//);
    expect(res.returnedRows).toBe(res.sample.length);
  });

  it("variance snapshot returns only exceptions (missing or over-threshold)", async () => {
    const res = await planning.varianceSnapshot({
      app: "Financ",
      cube: "ORC_Plan",
      thresholdPct: 0.05,
    });
    // Fixture: SP receita variance ~5.9% and RJ despesa actual is null.
    expect(res.totalRows).toBeGreaterThan(0);
    for (const row of res.sample) {
      const isMissing = row.actual === null || row.forecast === null;
      const overThreshold =
        row.variancePct !== null && Math.abs(row.variancePct) > 0.05;
      expect(isMissing || overThreshold).toBe(true);
    }
  });

  it("redaction guard rejects oversized inline payloads", () => {
    const verdict = checkOutboundPayload({
      rowCount: INLINE_ROW_LIMIT + 1,
      serialized: "[]",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/artifact/i);
  });
});
