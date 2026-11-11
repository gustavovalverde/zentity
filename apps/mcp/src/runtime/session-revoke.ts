import { config } from "../config.js";
import { discoverAgentConfiguration } from "./agent-configuration.js";
import type { OAuthSessionContext } from "./auth-context.js";

export async function revokeAgentSession(
  auth: OAuthSessionContext,
  sessionId: string
): Promise<void> {
  const agentConfiguration = await discoverAgentConfiguration(
    config.zentityUrl
  );
  const revokeUrl = agentConfiguration.revocation_endpoint;
  const response = await auth.dpopClient.fetch(revokeUrl, {
    method: "POST",
    accessToken: auth.accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Session revoke failed: ${response.status} ${text}`);
  }
}
