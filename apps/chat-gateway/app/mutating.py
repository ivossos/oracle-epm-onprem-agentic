"""Mirrors apps/claude-agent/src/policies/approval-policy.ts's MUTATING_ACTIONS/isMutating.

Keep in sync manually. This repo intentionally duplicates the mutating-action
check at each enforcement layer (client contract, agent write-guard, Claude
Code hook, and now this gateway) -- see docs/approval-model.md. This check
only decides whether the gateway pauses a turn for human approval; the real
enforcement (writeGuard) still runs inside the Node MCP tool handler.
"""

MUTATING_ACTIONS = [
    "execute_job", "run_business_rule", "run_ruleset",
    "update_substitution_variable", "import_metadata", "import_data",
    "import_supplemental", "refresh_cube", "restructure", "clear_data",
    "copy_data", "submit_journal", "approve_journal", "post_journal",
    "unpost_journal", "reject_journal", "update_journal_period",
    "run_integration", "run_pipeline", "run_data_rule", "lock_pov",
    "unlock_pov", "upload_file", "epm_automate_run", "automate_run",
]


def is_mutating(tool_name: str) -> bool:
    name = tool_name.lower()
    if name.endswith("_dry_run") or name.endswith("_plan"):
        return False
    return any(action in name for action in MUTATING_ACTIONS)
