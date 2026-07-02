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
  const body = JSON.stringify({ sessionId });

  const { response } = await auth.dpopClient.withNonceRetry(async (nonce) => {
    const proof = await auth.dpopClient.proofFor(
      "POST",
      revokeUrl,
      auth.accessToken,
      nonce
    );
    const attemptResponse = await fetch(revokeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `DPoP ${auth.accessToken}`,
        DPoP: proof,
      },
      body,
    });
    return { response: attemptResponse, result: null };
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Session revoke failed: ${response.status} ${text}`);
  }
}
