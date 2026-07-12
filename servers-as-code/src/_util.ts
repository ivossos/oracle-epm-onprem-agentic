import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BoundedResult } from "@epm/core-client";

/**
 * Writes a full payload to a workspace artifact and returns a bounded envelope
 * so large EPM extracts never flood model context. This is the code-execution
 * -with-MCP pattern: the model sees counts + a sample + an artifact path.
 */
export function boundAndPersist<T>(
  rows: T[],
  artifactPath: string,
  sampleSize = 25
): BoundedResult<T> {
  try {
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, JSON.stringify(rows, null, 2), "utf8");
  } catch {
    // artifact write is best-effort
  }
  const sample = rows.slice(0, sampleSize);
  return {
    totalRows: rows.length,
    returnedRows: sample.length,
    sample,
    artifactPath,
    truncated: rows.length > sample.length,
  };
}
