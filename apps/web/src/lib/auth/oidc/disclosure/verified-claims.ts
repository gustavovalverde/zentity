import "server-only";

import type { AuthContext } from "@better-auth/core";
import type { BetterAuthPlugin } from "better-auth";
import type { ClaimsRequest } from "./claims";

import { extendOAuthProvider } from "@better-auth/oauth-provider";

import { buildOidcVerifiedClaims, VERIFIED_CLAIM_NAMES } from "./claims";
import {
  claimsRequestForEndpoint,
  loadReleaseContext,
  RELEASE_BINDING_CLAIM,
  releaseIdFor,
} from "./context";

/**
 * OpenID Connect for Identity Assurance 1.0: `verified_claims` in the ID token
 * and UserInfo response. They are released only when the authorization
 * request's `claims` parameter asks for them for that endpoint (§6), filtered
 * to the requested `verification` and `claims` members (§6.4, §6.5). The
 * request is read from the release context Zentity binds at token issuance.
 */

const VERIFIED_CLAIMS = "verified_claims";

interface RequestedVerifiedClaims {
  claims?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requestedVerifiedClaims(
  request: ClaimsRequest | undefined
): RequestedVerifiedClaims | null {
  const requested = asRecord(request?.[VERIFIED_CLAIMS]);
  if (!requested) {
    return null;
  }
  const verification = asRecord(requested.verification);
  const claims = asRecord(requested.claims);
  if (!(verification || claims)) {
    return null;
  }
  return {
    ...(verification ? { verification } : {}),
    ...(claims ? { claims } : {}),
  };
}

function pickRequested(
  source: Record<string, unknown>,
  requested: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!requested) {
    return source;
  }
  return Object.fromEntries(
    Object.keys(requested)
      .filter((key) => Object.hasOwn(source, key) && source[key] !== undefined)
      .map((key) => [key, source[key]])
  );
}

async function releaseVerifiedClaims(input: {
  endpoint: "id_token" | "userinfo";
  releaseId: string | undefined;
  userId: string;
}): Promise<Record<string, unknown>> {
  if (!input.releaseId) {
    return {};
  }
  const releaseContext = await loadReleaseContext(input.releaseId);
  const requested = requestedVerifiedClaims(
    claimsRequestForEndpoint(
      releaseContext?.claimsRequest ?? null,
      input.endpoint
    )
  );
  if (!(releaseContext && requested)) {
    return {};
  }
  if (releaseContext.userId !== input.userId) {
    return {};
  }
  const verified = await buildOidcVerifiedClaims(input.userId);
  if (!verified) {
    return {};
  }
  return {
    [VERIFIED_CLAIMS]: {
      verification: pickRequested(
        verified.verification,
        requested.verification
      ),
      claims: pickRequested(verified.claims, requested.claims),
    },
  };
}

/** Contributes OIDC4IDA `verified_claims` and its discovery metadata. */
export function verifiedClaimsPlugin(): BetterAuthPlugin {
  return {
    id: "zentity-verified-claims",
    init(ctx: AuthContext) {
      extendOAuthProvider(ctx, {
        // OIDC4IDA 1.0 §5: OP metadata for verified claims.
        metadata: () => ({
          verified_claims_supported: true,
          trust_frameworks_supported: ["eidas"],
          claims_in_verified_claims_supported: [...VERIFIED_CLAIM_NAMES],
        }),
        claims: {
          idToken: ({ user, client, referenceId }) =>
            user?.id && referenceId
              ? releaseVerifiedClaims({
                  endpoint: "id_token",
                  releaseId: releaseIdFor(referenceId, client.clientId),
                  userId: user.id,
                })
              : {},
          userInfo: ({ user, jwt }) => {
            const releaseId = jwt[RELEASE_BINDING_CLAIM];
            return releaseVerifiedClaims({
              endpoint: "userinfo",
              releaseId: typeof releaseId === "string" ? releaseId : undefined,
              userId: user.id,
            });
          },
        },
      });
    },
  } as BetterAuthPlugin;
}
