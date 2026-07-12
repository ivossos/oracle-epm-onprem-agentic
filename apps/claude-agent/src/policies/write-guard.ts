import {
  isMutating,
  REQUIRED_SCOPE_FIELDS,
  DATA_SCOPE_FIELDS,
} from "./approval-policy.js";

export interface ApprovalPacket {
  id: string;
  environment: string;
  application: string;
  cube?: string;
  scenario?: string;
  version?: string;
  period?: string;
  entity?: string;
  restPayload: unknown;
  expectedArtifacts: string[];
  rollbackPath: string;
  residualRisk: string;
  userConfirmed: boolean;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Deterministic pre-tool guard. Blocks a mutating tool call unless a valid,
 * user-confirmed approval packet with complete scope is present.
 * Read-only tools always pass.
 */
export function writeGuard(
  toolName: string,
  packet?: ApprovalPacket
): GuardResult {
  if (!isMutating(toolName)) return { allowed: true };

  if (!packet) {
    return {
      allowed: false,
      reason: `'${toolName}' is a mutating action and requires an approval packet.`,
    };
  }
  if (!packet.userConfirmed) {
    return {
      allowed: false,
      reason: `Approval packet ${packet.id} is not user-confirmed.`,
    };
  }

  const missing: string[] = [];
  for (const f of REQUIRED_SCOPE_FIELDS) {
    if (!packet[f]) missing.push(f);
  }

  // Data/journal mutations need the full scope; job/file ops need only base.
  const needsDataScope = /clear_data|copy_data|journal|import_data|import_supplemental|refresh_cube|run_business_rule|run_ruleset/.test(
    toolName.toLowerCase()
  );
  if (needsDataScope) {
    for (const f of DATA_SCOPE_FIELDS) {
      if (!packet[f]) missing.push(f);
    }
  }

  if (missing.length > 0) {
    return {
      allowed: false,
      reason: `Approval packet ${packet.id} missing scope fields: ${missing.join(", ")}.`,
    };
  }
  return { allowed: true };
}
