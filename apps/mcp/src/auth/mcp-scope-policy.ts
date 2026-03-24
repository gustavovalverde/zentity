const MINIMAL_MCP_SCOPES = ["openid"] as const;

const REMOTE_TOOL_SCOPE_REQUIREMENTS: Record<string, string[]> = {
  check_compliance: ["openid", "compliance:key:read"],
  my_proofs: ["openid", "proof:identity"],
  whoami: ["openid", "email"],
};

interface JsonRpcRequest {
  method?: unknown;
  params?: unknown;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractToolName(payload: unknown): string | undefined {
  if (!isJsonObject(payload)) {
    return undefined;
  }

  const request = payload as JsonRpcRequest;
  if (request.method !== "tools/call" || !isJsonObject(request.params)) {
    return undefined;
  }

  const toolName = request.params.name;
  return typeof toolName === "string" ? toolName : undefined;
}

export function getMinimalMcpScopes(): string[] {
  return [...MINIMAL_MCP_SCOPES];
}

export function getRemoteMcpScopesSupported(): string[] {
  return [
    ...new Set([
      ...MINIMAL_MCP_SCOPES,
      ...Object.values(REMOTE_TOOL_SCOPE_REQUIREMENTS).flat(),
    ]),
  ];
}

export function getRemoteToolRequiredScopes(
  toolName: string
): string[] | undefined {
  const required = REMOTE_TOOL_SCOPE_REQUIREMENTS[toolName];
  return required ? [...required] : undefined;
}

export async function getRequiredScopesForRemoteRequest(
  request: Request
): Promise<string[]> {
  if (request.method !== "POST") {
    return getMinimalMcpScopes();
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return getMinimalMcpScopes();
  }

  const payload = await request
    .clone()
    .json()
    .catch(() => undefined);
  const toolName = extractToolName(payload);
  if (!toolName) {
    return getMinimalMcpScopes();
  }

  return getRemoteToolRequiredScopes(toolName) ?? getMinimalMcpScopes();
}
