import { describe, it, expect } from "vitest";
import { writeGuard, type ApprovalPacket } from "../policies/write-guard.js";
import { isMutating } from "../policies/approval-policy.js";
import { EpmClient } from "@epm/core-client";

const fullPacket: ApprovalPacket = {
  id: "AP-1",
  environment: "test-pod",
  application: "FCCS",
  cube: "Consol",
  scenario: "Actual",
  version: "Final",
  period: "Jun",
  entity: "LE_100",
  restPayload: {},
  expectedArtifacts: ["artifacts/jobs/x.log"],
  rollbackPath: "restore snapshot",
  residualRisk: "low",
  userConfirmed: true,
};

describe("destructive action blocked without full scope", () => {
  it("classifies mutating vs read-only correctly", () => {
    expect(isMutating("post_journal")).toBe(true);
    expect(isMutating("clear_data")).toBe(true);
    expect(isMutating("fccs_close_readiness_report")).toBe(false);
    expect(isMutating("import_metadata_dry_run")).toBe(false);
    expect(isMutating("planning_import_metadata_plan")).toBe(false);
  });

  it("blocks a mutating tool with no packet", () => {
    const r = writeGuard("post_journal");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/approval packet/i);
  });

  it("blocks when packet is not user-confirmed", () => {
    const r = writeGuard("post_journal", { ...fullPacket, userConfirmed: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not user-confirmed/i);
  });

  it("blocks a data mutation missing data-scope fields", () => {
    const r = writeGuard("clear_data", {
      ...fullPacket,
      cube: "",
      period: "",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/missing scope/i);
  });

  it("allows a fully-scoped, confirmed mutation", () => {
    const r = writeGuard("post_journal", fullPacket);
    expect(r.allowed).toBe(true);
  });

  it("client refuses executeJob without an approval packet id", async () => {
    const client = new EpmClient();
    await expect(client.executeJob("FCCS", "Refresh", "")).rejects.toThrow(
      /missing approvalPacketId/
    );
  });
});
