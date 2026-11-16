import "server-only";

import type {
  AgentAuthorization,
  HostAttestationTier,
} from "@zentity/sdk/protocol";

import { eq } from "drizzle-orm";
import { decodeJwt, type JWTPayload } from "jose";

import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { findCibaApproval } from "@/lib/db/queries/ciba";
import { type CibaApproval, cibaApprovals } from "@/lib/db/schema/ciba";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";

import { buildAgentAuthorization } from "./claims";

/**
 * The verified agent behind a CIBA token, from the approval record alone:
 * the decision copies the agent session and attestation only when an
 * Agent-Assertion bound the request.
 */
export interface AgentApproval {
  attestation: {
    provider: string | null;
    tier: HostAttestationTier;
    verified: boolean;
  };
  authorization: AgentAuthorization;
  sessionId: string;
}

function asHostAttestationTier(value: string | null): HostAttestationTier {
  switch (value) {
    case "attested":
    case "self-declared":
    case "unverified":
      return value;
    default:
      return "unverified";
  }
}

/** The agent an approval names, or null without a verified agent. */
export function agentApprovalFor(approval: CibaApproval): AgentApproval | null {
  const authorization = buildAgentAuthorization(approval);
  if (!(approval.agentSessionId && authorization)) {
    return null;
  }
  const tier = asHostAttestationTier(approval.attestationTier);
  return {
    sessionId: approval.agentSessionId,
    attestation: {
      provider: approval.attestationProvider,
      tier,
      verified: tier === "attested",
    },
    authorization,
  };
}

/**
 * The approval record of a CIBA access token: a JWT by its `jti`, an opaque
 * token by its `reference_id`, the stored `auth_req_id` hash.
 */
export async function findApprovalForToken(
  token: { jti: string } | { referenceId: string }
): Promise<CibaApproval | null> {
  if ("referenceId" in token) {
    return (await findCibaApproval(token.referenceId)) ?? null;
  }
  return (
    (await db
      .select()
      .from(cibaApprovals)
      .where(eq(cibaApprovals.tokenJti, token.jti))
      .limit(1)
      .get()) ?? null
  );
}

function decodeJwtAccessToken(token: string): JWTPayload | null {
  if (token.split(".").length !== 3) {
    return null;
  }
  try {
    return decodeJwt(token);
  } catch {
    return null;
  }
}

/**
 * Records on the approval the one access token it issued: a JWT's `jti`,
 * `aud`, and `iat`, or for an opaque token its stored resources and issue
 * time.
 */
export async function recordApprovalToken(input: {
  accessToken: string;
  referenceId: string;
}): Promise<void> {
  const payload = decodeJwtAccessToken(input.accessToken);
  let token: { audience: string[] | null; issuedAt: Date; jti: string | null };
  if (payload) {
    token = {
      jti: typeof payload.jti === "string" ? payload.jti : null,
      audience: payload.aud === undefined ? null : [payload.aud].flat(),
      issuedAt:
        typeof payload.iat === "number"
          ? new Date(payload.iat * 1000)
          : new Date(),
    };
  } else {
    const stored = await db
      .select({
        createdAt: oauthAccessTokens.createdAt,
        resources: oauthAccessTokens.resources,
      })
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.referenceId, input.referenceId))
      .limit(1)
      .get();
    const resources = parseStoredStringArray(stored?.resources ?? null);
    token = {
      jti: null,
      audience: resources.length > 0 ? resources : null,
      issuedAt: stored?.createdAt ?? new Date(),
    };
  }

  await db
    .update(cibaApprovals)
    .set({
      tokenJti: token.jti,
      tokenAudience: token.audience ? JSON.stringify(token.audience) : null,
      tokenIssuedAt: token.issuedAt,
    })
    .where(eq(cibaApprovals.referenceId, input.referenceId))
    .run();
}
