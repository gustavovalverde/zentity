import crypto from "node:crypto";

import { eq } from "drizzle-orm";

import { computeConsentHmac } from "@/lib/auth/oidc/disclosure/claims";
import { isIdentityScope } from "@/lib/auth/oidc/disclosure/registry";
import { db } from "@/lib/db/connection";
import { verifications } from "@/lib/db/schema/auth";
import { oauthClients, oauthConsents } from "@/lib/db/schema/oauth-provider";
import { getConsentHmacKey } from "@/lib/privacy/primitives/derived-keys";

import { createTestSession } from "./db-test-utils";
import { type DpopKeyPair, postTokenWithDpop } from "./dpop-test-utils";

const WHITESPACE_RE = /\s+/;

function sha256Base64Url(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

interface AuthorizationCodeInput {
  clientId: string;
  redirectUri: string;
  resource?: string;
  scope?: string;
  /** An existing session to bind the code to; a new one is created otherwise. */
  session?: { authContextId: string; sessionId: string };
  userId: string;
}

export async function seedTestCodeConsent(input: {
  clientId: string;
  referenceId: string;
  resource?: string;
  scope?: string;
  userId: string;
}) {
  const scopes = (input.scope ?? "openid")
    .split(WHITESPACE_RE)
    .filter((scope) => scope && !isIdentityScope(scope));
  const client = await db
    .select({ skipConsent: oauthClients.skipConsent })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, input.clientId))
    .limit(1)
    .get();
  if (!client?.skipConsent) {
    await db
      .insert(oauthConsents)
      .values({
        clientId: input.clientId,
        userId: input.userId,
        referenceId: input.referenceId,
        ...(input.resource
          ? { resources: JSON.stringify([input.resource]) }
          : {}),
        scopes: JSON.stringify(scopes),
        scopeHmac: computeConsentHmac(
          getConsentHmacKey(),
          input.userId,
          input.clientId,
          input.referenceId,
          scopes
        ),
      })
      .run();
  }
}

/**
 * Stores an authorization code as the provider does after consent, and
 * returns the token request parameters that redeem it.
 */
export async function seedTestAuthorizationCode(input: AuthorizationCodeInput) {
  const session = input.session ?? (await createTestSession(input.userId));
  const codeVerifier = `pkce-verifier-${crypto.randomUUID()}`;
  const code = `auth-code-${crypto.randomUUID()}`;
  const referenceId = `reference-${crypto.randomUUID()}`;
  const now = Date.now();
  await seedTestCodeConsent({ ...input, referenceId });
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
        referenceId,
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

  return {
    session,
    tokenRequest: {
      grant_type: "authorization_code",
      client_id: input.clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: input.redirectUri,
      ...(input.resource ? { resource: input.resource } : {}),
    },
  };
}

/** Seeds an authorization code and redeems it with PKCE and DPoP. */
export async function redeemTestAuthorizationCode(
  input: AuthorizationCodeInput & { dpopKeyPair?: DpopKeyPair }
) {
  const { session, tokenRequest } = await seedTestAuthorizationCode(input);
  const result = await postTokenWithDpop(tokenRequest, input.dpopKeyPair);
  return { ...result, session };
}
