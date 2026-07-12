import { describe, it, expect } from "vitest";
import { automate } from "@epm/servers-as-code";

describe("epm automate wrapper (allowlist + approval gating)", () => {
  it("lists the typed allowlist", async () => {
    const cmds = await automate.listCommands();
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds.some((c) => c.command === "downloadSnapshot")).toBe(true);
  });

  it("refuses a command that is not on the allowlist (no arbitrary shell)", async () => {
    await expect(
      automate.runApprovedCommand({ command: "rm -rf /", actor: "test" })
    ).rejects.toThrow(/not on the allowlist/i);
  });

  it("runs a read-only command directly (no packet needed)", async () => {
    const r = await automate.runApprovedCommand({
      command: "downloadSnapshot",
      params: { snapshotName: "Artifact Snapshot" },
      actor: "test",
    });
    expect(r.status).toBe("COMPLETED");
    expect(r.command).toBe("downloadSnapshot");
  });

  it("refuses a read-only command missing a required param", async () => {
    await expect(
      automate.runApprovedCommand({ command: "downloadSnapshot", actor: "test" })
    ).rejects.toThrow(/missing required param 'snapshotName'/i);
  });

  it("refuses a mutating command without an approval packet", async () => {
    await expect(
      automate.runApprovedCommand({ command: "runDailyMaintenance", actor: "test" })
    ).rejects.toThrow(/requires approvalPacketId/i);
  });

  it("runs a mutating command when a packet id is supplied", async () => {
    const r = await automate.runApprovedCommand({
      command: "uploadFile",
      params: { fileName: "data.zip" },
      approvalPacketId: "AP-9",
      actor: "test",
    });
    expect(r.status).toBe("COMPLETED");
    expect(r.artifactPath).toMatch(/artifacts\/automate\//);
  });
});
