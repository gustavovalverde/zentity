/**
 * Agent display helpers.
 *
 * Detects the connected MCP client from the protocol's `initialize` handshake
 * (`clientInfo`) and provides user-facing labels for approval prompts.
 */

export interface AgentInfo {
  model: string;
  name: string;
  runtime: string;
  version: string;
}

interface KnownAgent {
  displayName: string;
  model: string;
}

const KNOWN_AGENTS: Record<string, KnownAgent> = {
  "claude-code": { displayName: "Claude Code", model: "claude" },
  "codex-cli": { displayName: "Codex", model: "codex" },
  opencode: { displayName: "OpenCode", model: "opencode" },
};

/**
 * Detect the agent from MCP client metadata.
 *
 * Priority: clientInfo.name lookup → explicit ZENTITY_AGENT_NAME override.
 * Missing both is a bootstrap error because runtime identity must be explicit.
 */
export function detectAgent(
  clientInfo?: { name: string; version: string } | undefined
): AgentInfo {
  if (clientInfo) {
    const known = KNOWN_AGENTS[clientInfo.name];
    return {
      name: known?.displayName ?? clientInfo.name,
      model: known?.model ?? "unknown",
      version: clientInfo.version,
      runtime: "node",
    };
  }

  const envName = process.env.ZENTITY_AGENT_NAME;
  if (envName) {
    return {
      name: envName,
      model: "unknown",
      version: "unknown",
      runtime: "node",
    };
  }

  throw new Error(
    "MCP clientInfo is required for runtime identity unless ZENTITY_AGENT_NAME is set"
  );
}

/** Prefix a binding message with the agent's display name. */
export function prefixBindingMessage(
  agentName: string,
  message: string
): string {
  return `${agentName}: ${message}`;
}
