import { config } from "../config.js";
import { discoverAgentConfiguration } from "./agent-configuration.js";
import type { OAuthSessionContext } from "./context.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";

export async function revokeAgentSession(
  auth: OAuthSessionContext,
  sessionId: string
): Promise<void> {
  const agentConfiguration = await discoverAgentConfiguration(
    config.zentityUrl
  );
  const revokeUrl = agentConfiguration.revocation_endpoint;
  const body = JSON.stringify({ sessionId });

  let proof = await createDpopProof(
    auth.dpopKey,
    "POST",
    revokeUrl,
    auth.accessToken
  );
  let response = await fetch(revokeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `DPoP ${auth.accessToken}`,
      DPoP: proof,
    },
    body,
  });

  const nonce = extractDpopNonce(response);
  if (nonce && (response.status === 400 || response.status === 401)) {
    proof = await createDpopProof(
      auth.dpopKey,
      "POST",
      revokeUrl,
      auth.accessToken,
      nonce
    );
    response = await fetch(revokeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `DPoP ${auth.accessToken}`,
        DPoP: proof,
      },
      body,
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Session revoke failed: ${response.status} ${text}`);
  }
}
