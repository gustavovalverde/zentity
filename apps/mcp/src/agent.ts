/**
 * Agent display helpers.
 *
 * Detects the connected MCP client from its self-reported identity (the
 * per-request envelope on 2026-07-28 connections, the `initialize` handshake
 * on earlier ones) and provides user-facing labels for approval prompts.
 */

import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  type ClientCapabilities,
  type Implementation,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";

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
export function detectAgent(clientInfo: Implementation | undefined): AgentInfo {
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

function envelopeValue<T>(ctx: ServerContext, key: string): T | undefined {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  return envelope?.[key] as T | undefined;
}

export function clientInfoOf(
  server: McpServer,
  ctx: ServerContext
): Implementation | undefined {
  return (
    envelopeValue<Implementation>(ctx, CLIENT_INFO_META_KEY) ??
    server.server.getClientVersion()
  );
}

export function clientCapabilitiesOf(
  server: McpServer,
  ctx: ServerContext
): ClientCapabilities | undefined {
  return (
    envelopeValue<ClientCapabilities>(ctx, CLIENT_CAPABILITIES_META_KEY) ??
    server.server.getClientCapabilities()
  );
}
