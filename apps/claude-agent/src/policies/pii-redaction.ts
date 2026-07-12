/**
 * PII / financial-data redaction guard. Prevents full financial extracts,
 * security exports, or credential-like strings from being pasted into chat
 * context when a file artifact reference is sufficient.
 */

const CREDENTIAL_PATTERNS: RegExp[] = [
  /password\s*[:=]\s*\S+/i,
  /Basic\s+[A-Za-z0-9+/=]{16,}/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/,
  /["']?client_secret["']?\s*[:=]\s*\S+/i,
];

/** Max rows allowed inline before a result must be replaced by an artifact ref. */
export const INLINE_ROW_LIMIT = 50;

export function scrubCredentials(text: string): string {
  let out = text;
  for (const re of CREDENTIAL_PATTERNS) {
    out = out.replace(re, (m) => m.split(/[:=]/)[0] + "=***REDACTED***");
  }
  return out;
}

export interface RedactionVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Returns not-ok when a payload should be replaced by an artifact reference
 * (too many rows) or contains credential-like material.
 */
export function checkOutboundPayload(args: {
  rowCount: number;
  serialized: string;
}): RedactionVerdict {
  for (const re of CREDENTIAL_PATTERNS) {
    if (re.test(args.serialized)) {
      return { ok: false, reason: "Payload contains credential-like material." };
    }
  }
  if (args.rowCount > INLINE_ROW_LIMIT) {
    return {
      ok: false,
      reason: `Payload has ${args.rowCount} rows (> ${INLINE_ROW_LIMIT}); return an artifact path + sample instead.`,
    };
  }
  return { ok: true };
}
