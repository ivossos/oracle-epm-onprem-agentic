"""Claude <-> MCP tool loop shared by /api/chat and /api/approve."""
import anthropic

from .config import ANTHROPIC_MODEL, MAX_TOKENS
from .mcp_pool import McpToolPool
from .mutating import is_mutating
from .sessions import ChatSession, PendingTurn

SYSTEM_PROMPT = """You are an assistant for Oracle EPM administration -- \
Planning, FCCS, HFM, Data Integration, metadata governance, security audit, \
and EPM Automate -- operating in MOCK mode against fixture data -- no real \
Oracle system is touched.

Your tools span: Planning (data slices, variance, substitution variables), \
core (applications, job definitions/status, executing a job), FCCS (close \
readiness, metadata validation, journals, intercompany matching), HFM \
(consolidation), Data Integration (pipeline inventory, failed loads, POV \
locks), metadata governance (snapshots, diffs, risk), security audit (role/\
access/login reports, read-only), and EPM Automate (allowlisted commands only).

`epm_execute_job` and `automate_run_approved_command` are MUTATING and take \
an `approvalPacket` argument. Any other tool whose name contains things like \
execute_job, run_business_rule, clear_data, copy_data, or similar write \
actions follows the same pattern. Whenever you call a mutating tool:
  - Populate `approvalPacket` fully: a unique `id`, `environment` (use "mock" \
unless told otherwise), `application`, `restPayload`, `expectedArtifacts`, \
`rollbackPath`, and `residualRisk`.
  - Always set `userConfirmed: false` yourself -- a human must approve first; \
the system flips it to true after approval.
  - Propose exactly ONE mutating tool call per turn, then stop and wait.
  - If a tool result comes back as `{"blocked": true, "reason": "..."}`, fix \
the approval packet (still with userConfirmed:false) and retry, or explain the \
blocker to the user.

FORMATTING: when returning tabular data, use a markdown pipe table \
(| Col | Col |) -- the UI renders it as a spreadsheet grid.
"""


def _to_history_block(block) -> dict:
    return block.model_dump()


async def _execute_tool_use_blocks(pool: McpToolPool, blocks: list) -> list[dict]:
    results = []
    for block in blocks:
        text, is_error = await pool.call_tool(block.name, block.input)
        results.append({
            "type": "tool_result",
            "tool_use_id": block.id,
            "content": [{"type": "text", "text": text}],
            "is_error": is_error,
        })
    return results


async def run_turn(session: ChatSession, client: anthropic.Anthropic, pool: McpToolPool) -> dict:
    """Drives the Claude<->tool loop until a plain-text turn or a pause-for-approval."""
    while True:
        response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            tools=pool.anthropic_tools,
            messages=session.history,
        )
        assistant_blocks = [_to_history_block(b) for b in response.content]
        session.history.append({"role": "assistant", "content": assistant_blocks})

        tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
        if not tool_use_blocks:
            return {"status": None, "tool_call": None}

        mutating = next((b for b in tool_use_blocks if is_mutating(b.name)), None)
        if mutating:
            others = [b for b in tool_use_blocks if b.id != mutating.id]
            session.pending = PendingTurn(
                mutating_tool_use_id=mutating.id,
                mutating_tool_name=mutating.name,
                mutating_arguments=dict(mutating.input),
                other_tool_use_blocks=[_to_history_block(b) for b in others],
            )
            return {
                "status": "awaiting_approval",
                "tool_call": {"id": mutating.id, "name": mutating.name, "arguments": mutating.input},
            }

        result_blocks = await _execute_tool_use_blocks(pool, tool_use_blocks)
        session.history.append({"role": "user", "content": result_blocks})
        # loop continues


async def resume_after_approval(
    session: ChatSession, approved: bool, client: anthropic.Anthropic, pool: McpToolPool
) -> dict:
    pending = session.pending
    assert pending is not None, "resume_after_approval called without a pending turn"

    result_blocks: list[dict] = []

    if approved:
        arguments = dict(pending.mutating_arguments)
        packet = dict(arguments.get("approvalPacket") or {})
        packet["userConfirmed"] = True
        arguments["approvalPacket"] = packet
        text, is_error = await pool.call_tool(pending.mutating_tool_name, arguments)
        result_blocks.append({
            "type": "tool_result",
            "tool_use_id": pending.mutating_tool_use_id,
            "content": [{"type": "text", "text": text}],
            "is_error": is_error,
        })
    else:
        result_blocks.append({
            "type": "tool_result",
            "tool_use_id": pending.mutating_tool_use_id,
            "content": [{
                "type": "text",
                "text": "The human denied this action. Do not attempt it again this turn; "
                        "ask the user how they'd like to proceed.",
            }],
            "is_error": True,
        })

    for block in pending.other_tool_use_blocks:
        text, is_error = await pool.call_tool(block["name"], block["input"])
        result_blocks.append({
            "type": "tool_result",
            "tool_use_id": block["id"],
            "content": [{"type": "text", "text": text}],
            "is_error": is_error,
        })

    session.history.append({"role": "user", "content": result_blocks})
    session.pending = None
    return await run_turn(session, client, pool)
