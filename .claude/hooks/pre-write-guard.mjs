#!/usr/bin/env node
/**
 * PreToolUse hook: deterministic block for mutating EPM tools.
 *
 * Claude Code passes the tool-call JSON on stdin. We block unless the tool
 * input carries an approvalPacket with `userConfirmed: true` and the required
 * scope fields. Exit code 2 blocks the call; the `reason` is surfaced to the
 * model. This does NOT rely on model judgment.
 */

const REQUIRED = ["environment", "application"];

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    deny("Could not parse tool-call payload.");
    return;
  }

  const toolName = payload.tool_name ?? payload.toolName ?? "";
  const input = payload.tool_input ?? payload.toolInput ?? {};
  const packet = input.approvalPacket;

  if (!packet) {
    deny(`'${toolName}' is mutating and requires an approval packet.`);
    return;
  }
  if (!packet.userConfirmed) {
    deny(`Approval packet ${packet.id ?? "?"} is not user-confirmed.`);
    return;
  }
  const missing = REQUIRED.filter((f) => !packet[f]);
  if (missing.length) {
    deny(`Approval packet missing scope: ${missing.join(", ")}.`);
    return;
  }
  // Allowed.
  process.exit(0);
});

function deny(reason) {
  process.stderr.write(reason + "\n");
  process.exit(2);
}
