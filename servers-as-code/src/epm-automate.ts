import { EpmClient, audit } from "@epm/core-client";
import type {
  AutomateCommandSpec,
  AutomateResult,
  AutomateRunbook,
} from "@epm/core-client";

const client = new EpmClient();

export async function listCommands(): Promise<AutomateCommandSpec[]> {
  return client.listAutomateCommands();
}

export async function runbookStatus(): Promise<AutomateRunbook[]> {
  return client.listAutomateRunbooks();
}

/**
 * Runs an allowlisted EPM Automate command. Never exposes arbitrary shell.
 * Mutating commands require an approval packet id and are audited.
 */
export async function runApprovedCommand(args: {
  command: string;
  params?: Record<string, string>;
  approvalPacketId?: string;
  actor: string;
}): Promise<AutomateResult> {
  const result = await client.runAutomateCommand({
    command: args.command,
    params: args.params ?? {},
    approvalPacketId: args.approvalPacketId,
  });

  const commands = await client.listAutomateCommands();
  const spec = commands.find((c) => c.command === args.command);
  if (spec?.mutating) {
    audit({
      actor: args.actor,
      action: `automate_run:${args.command}`,
      mutating: true,
      scope: { command: args.command, params: args.params ?? {} },
      requestPayload: args.params ?? {},
      status: result.status,
      approvalPacketId: args.approvalPacketId,
      mode: client.config.mode,
    });
  }
  return result;
}
