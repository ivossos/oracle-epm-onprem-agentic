import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Append-only audit trail. Every mutating operation MUST call this.
 * Writes JSONL to artifacts/audit.log (gitignored) and returns the record.
 */
export interface AuditRecord {
  ts: string;
  actor: string;
  action: string;
  mutating: boolean;
  scope: Record<string, unknown>;
  requestPayload?: unknown;
  jobId?: number;
  status?: string;
  approvalPacketId?: string;
  mode: "mock" | "live";
}

const AUDIT_PATH = process.env.EPM_AUDIT_PATH ?? "artifacts/audit.log";

export function audit(record: Omit<AuditRecord, "ts">): AuditRecord {
  const full: AuditRecord = { ts: new Date().toISOString(), ...record };
  try {
    mkdirSync(dirname(AUDIT_PATH), { recursive: true });
    appendFileSync(AUDIT_PATH, JSON.stringify(full) + "\n", "utf8");
  } catch {
    // Auditing must never crash the tool; surface via return value instead.
  }
  return full;
}
