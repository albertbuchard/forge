export class MachineToolPolicyError extends Error {
  readonly code = "machine_tool_not_enabled";

  constructor(toolKey: string) {
    super(`The requested tool "${toolKey}" is not enabled for this connector.`);
    this.name = "MachineToolPolicyError";
  }
}

export function requireEnabledTool<T extends { key: string }>(
  activeTools: readonly T[],
  requestedKey: string
): T {
  const selected = activeTools.find((tool) => tool.key === requestedKey);
  if (!selected) {
    throw new MachineToolPolicyError(requestedKey);
  }
  return selected;
}
