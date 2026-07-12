/**
 * Approval policy: which tool actions are mutating and therefore require an
 * approval packet + explicit scope. Single source of truth shared by the
 * MCP write-guard and the agent hooks.
 */

/** Tool name substrings that indicate a state-changing operation. */
export const MUTATING_ACTIONS = [
  "execute_job",
  "run_business_rule",
  "run_ruleset",
  "update_substitution_variable",
  "import_metadata",
  "import_data",
  "import_supplemental",
  "refresh_cube",
  "restructure",
  "clear_data",
  "copy_data",
  "submit_journal",
  "approve_journal",
  "post_journal",
  "unpost_journal",
  "reject_journal",
  "update_journal_period",
  "run_integration",
  "run_pipeline",
  "run_data_rule",
  "lock_pov",
  "unlock_pov",
  "upload_file",
  "epm_automate_run",
  "automate_run",
] as const;

export function isMutating(toolName: string): boolean {
  const n = toolName.toLowerCase();
  // A *_dry_run or *_plan variant of a mutating action is always read-only.
  if (n.endsWith("_dry_run") || n.endsWith("_plan")) return false;
  return MUTATING_ACTIONS.some((a) => n.includes(a));
}

/** Fields that must be present in the scope of any write operation. */
export const REQUIRED_SCOPE_FIELDS = [
  "environment",
  "application",
] as const;

/** Additional scope fields required for data/journal mutations specifically. */
export const DATA_SCOPE_FIELDS = [
  "cube",
  "scenario",
  "version",
  "period",
  "entity",
] as const;
