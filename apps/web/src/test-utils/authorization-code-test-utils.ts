import crypto from "node:crypto";

import { db } from "@/lib/db/connection";
import { verifications } from "@/lib/db/schema/auth";

import { createTestSession } from "./db-test-utils";
import { type DpopKeyPair, postTokenWithDpop } from "./dpop-test-utils";

function sha256Base64Url(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

interface AuthorizationCodeInput {
  clientId: string;
  dpopKeyPair?: DpopKeyPair;
  redirectUri: string;
  resource?: string;
  scope?: string;
  /** An existing session to bind the code to; a new one is created otherwise. */
  session?: { authContextId: string; sessionId: string };
  userId: string;
}

/**
 * Stores an authorization code as the provider does after consent and redeems
 * it at the token endpoint with PKCE and DPoP.
 */
export async function redeemTestAuthorizationCode(
  input: AuthorizationCodeInput
) {
  const session = input.session ?? (await createTestSession(input.userId));
  const codeVerifier = `pkce-verifier-${crypto.randomUUID()}`;
  const code = `auth-code-${crypto.randomUUID()}`;
  const now = Date.now();
  const query = {
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: input.scope ?? "openid",
    code_challenge: sha256Base64Url(codeVerifier),
    code_challenge_method: "S256",
    ...(input.resource ? { resource: input.resource } : {}),
  };

  await db
    .insert(verifications)
    .values({
      id: crypto.randomUUID(),
      identifier: sha256Base64Url(code),
      value: JSON.stringify({
        type: "authorization_code",
        referenceId: `reference-${crypto.randomUUID()}`,
        query,
        userId: input.userId,
        sessionId: session.sessionId,
        authContextId: session.authContextId,
        authTime: now,
      }),
      createdAt: new Date(now),
      updatedAt: new Date(now),
      expiresAt: new Date(now + 5 * 60 * 1000),
    })
    .run();

  const result = await postTokenWithDpop(
    {
      grant_type: "authorization_code",
      client_id: input.clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: input.redirectUri,
      ...(input.resource ? { resource: input.resource } : {}),
    },
    input.dpopKeyPair
  );
  return { ...result, session };
}
