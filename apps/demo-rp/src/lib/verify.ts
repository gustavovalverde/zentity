import "server-only";

import { encodePath, SDJwtInstance, splitSdJwt } from "@sd-jwt/core";
import { decodeBase64UrlJsonStrict } from "@zentity/sdk/protocol";
import { createJwksTokenVerifier } from "@zentity/sdk/rp";
import { compactVerify, importJWK, type JWK } from "jose";

import { env } from "@/lib/env";
import { readDisclosedClaims, sha256Hasher } from "@/lib/sd-jwt";
import type {
  DcqlCredentialQuery,
  DcqlQuery,
} from "@/scenarios/veripass/verifier-scenario";

const MAX_KB_JWT_AGE_SECONDS = 300;

let issuerTokenVerifier: ReturnType<typeof createJwksTokenVerifier> | undefined;
function getIssuerTokenVerifier() {
  issuerTokenVerifier ??= createJwksTokenVerifier({
    jwksUrl: env.ZENTITY_JWKS_URL ?? `${env.ZENTITY_URL}/api/auth/oauth2/jwks`,
  });
  return issuerTokenVerifier;
}

const sdjwt = new SDJwtInstance({
  hasher: sha256Hasher,
  async verifier(data, signature) {
    try {
      await getIssuerTokenVerifier().verify(`${data}.${signature}`);
      return true;
    } catch {
      return false;
    }
  },
  // The issuer binds the credential to the holder key it carries as cnf.jwk
  // (SD-JWT VC); the KB-JWT must verify against that key. It is imported for
  // the KB-JWT's alg: holder JWKs may omit alg, or name Ed25519 for EdDSA.
  async kbVerifier(data, signature, payload) {
    const holderJwk = payload.cnf?.jwk as JWK | undefined;
    if (!holderJwk) {
      return false;
    }
    try {
      await compactVerify(`${data}.${signature}`, (header) =>
        importJWK(holderJwk, header.alg)
      );
      return true;
    } catch {
      return false;
    }
  },
});

export interface VpTokenExpectations {
  /** The Client Identifier the request advertised: the KB-JWT audience. */
  audience: string;
  /** The DCQL query the request carried. */
  dcqlQuery: DcqlQuery;
  /** The nonce the request carried. */
  nonce: string;
}

/**
 * Returns the one SD-JWT presentation a `vp_token` carries for `query`, or
 * null when the token has another shape.
 *
 * OpenID4VP 1.0 keys `vp_token` by credential query id, each holding an array
 * of presentations; the query does not set `multiple`, so exactly one is
 * allowed. Earlier drafts sent the bare presentation string, which is still
 * accepted.
 */
function selectPresentation(
  vpToken: unknown,
  query: DcqlCredentialQuery
): string | null {
  if (typeof vpToken === "string") {
    return vpToken;
  }
  if (typeof vpToken !== "object" || vpToken === null) {
    return null;
  }
  const entries = Object.entries(vpToken);
  if (entries.length !== 1) {
    return null;
  }
  const [[queryId, presentations]] = entries as [[string, unknown]];
  if (
    queryId !== query.id ||
    !Array.isArray(presentations) ||
    presentations.length !== 1 ||
    typeof presentations[0] !== "string"
  ) {
    return null;
  }
  return presentations[0];
}

/**
 * Verifies a `vp_token` against the request it answers and returns the
 * claims the holder disclosed, or null when the token is rejected.
 *
 * The token must answer the request's single DCQL credential query: a
 * credential whose `vct` the query names and which carries every claim path
 * the query lists. Claims beyond the query are accepted.
 *
 * The issuer JWT must verify against the Zentity JWKS and every disclosure
 * must match a digest the issuer signed. The KB-JWT must be signed by the
 * credential's `cnf.jwk` holder key over this exact presentation (`sd_hash`),
 * for this verifier and nonce, within the last five minutes.
 */
export async function verifyVpToken(
  vpToken: unknown,
  expected: VpTokenExpectations
): Promise<Record<string, unknown> | null> {
  const [query, ...otherQueries] = expected.dcqlQuery.credentials;
  if (!query || otherQueries.length > 0) {
    return null;
  }
  const presentation = selectPresentation(vpToken, query);
  if (!presentation) {
    return null;
  }
  try {
    // @sd-jwt/core reads disclosures with JSON.parse, which keeps the last of
    // duplicate member names. Reject those so every parser sees one value.
    for (const disclosure of splitSdJwt(presentation).disclosures) {
      decodeBase64UrlJsonStrict(disclosure);
    }
    const { kb } = await sdjwt.verify(presentation, {
      expectedVct: query.meta.vct_values,
      requiredClaimKeys: query.claims.map((claim) => encodePath(claim.path)),
      keyBindingNonce: expected.nonce,
      expectedKeyBindingAudience: expected.audience,
      keyBindingMaxAgeSeconds: MAX_KB_JWT_AGE_SECONDS,
    });
    // verify() skips holder binding without a nonce; never accept that.
    if (!kb) {
      return null;
    }
    return await readDisclosedClaims(sdjwt, presentation);
  } catch {
    return null;
  }
}
