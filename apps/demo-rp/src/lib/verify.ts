import "server-only";

import { encodePath, splitSdJwt } from "@sd-jwt/core";
import { SdJwtVcInstance, type SdJwtVcPayload } from "@sd-jwt/sd-jwt-vc";
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
// Zentity mints the status list token when it is fetched, and wallets set the
// KB-JWT iat from their own clocks, so either can be slightly ahead of ours.
const CLOCK_SKEW_SECONDS = 30;
const STATUS_LIST_MEDIA_TYPE = "application/statuslist+jwt";
const STATUS_LIST_TIMEOUT_MS = 5000;
const MAX_STATUS_LIST_BYTES = 64 * 1024;

/**
 * The `iss` Zentity puts in the credentials it issues: its public URL plus the
 * auth base path. The public URL, not `ZENTITY_URL`, which may be an internal
 * address the issuer never names.
 */
function getExpectedIssuer(): string {
  return `${env.NEXT_PUBLIC_ZENTITY_URL}/api/auth`;
}

let issuerTokenVerifier: ReturnType<typeof createJwksTokenVerifier> | undefined;
function getIssuerTokenVerifier() {
  issuerTokenVerifier ??= createJwksTokenVerifier({
    jwksUrl: env.ZENTITY_JWKS_URL ?? `${env.ZENTITY_URL}/api/auth/oauth2/jwks`,
    issuer: getExpectedIssuer(),
  });
  return issuerTokenVerifier;
}

/** Verifies a JWT Zentity signed: the credential or its status list token. */
async function verifyIssuerSignature(
  data: string,
  signature: string
): Promise<boolean> {
  try {
    await getIssuerTokenVerifier().verify(`${data}.${signature}`);
    return true;
  } catch {
    return false;
  }
}

/** Errors the stream once it has carried more than `maxBytes`. */
function limitBytes(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): ReadableStream<Uint8Array> {
  let received = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes) {
          controller.error(new Error("Status list exceeds the size limit"));
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
}

/**
 * Fetches the Token Status List a credential references. Only the credential
 * issuer's origin is fetched, so a credential cannot point the verifier at
 * another host, and every presentation reads the list afresh.
 */
async function fetchStatusList(uri: string): Promise<string> {
  const url = new URL(uri);
  if (url.origin !== new URL(getExpectedIssuer()).origin) {
    throw new Error("Status list is not served by the credential issuer");
  }
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: STATUS_LIST_MEDIA_TYPE },
    redirect: "error",
    signal: AbortSignal.timeout(STATUS_LIST_TIMEOUT_MS),
  });
  const mediaType = response.headers.get("content-type")?.split(";")[0];
  if (
    !(response.ok && response.body) ||
    mediaType?.trim().toLowerCase() !== STATUS_LIST_MEDIA_TYPE
  ) {
    await response.body?.cancel();
    throw new Error(`Status list request failed: ${response.status}`);
  }
  return new Response(limitBytes(response.body, MAX_STATUS_LIST_BYTES)).text();
}

const sdjwt = new SdJwtVcInstance({
  hasher: sha256Hasher,
  verifier: verifyIssuerSignature,
  statusVerifier: verifyIssuerSignature,
  statusListFetcher: fetchStatusList,
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

/** Zentity issues every credential with a Token Status List reference. */
function hasStatusListReference(payload: SdJwtVcPayload): boolean {
  const reference = payload.status?.status_list;
  return typeof reference?.uri === "string" && Number.isInteger(reference.idx);
}

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
 * The issuer JWT must verify against the Zentity JWKS, name Zentity as `iss`,
 * and every disclosure must match a digest the issuer signed. The credential
 * must reference a Token Status List on the issuer's origin, and that list,
 * signed by the same JWKS, must mark it valid. The KB-JWT must be signed by
 * the credential's `cnf.jwk` holder key over this exact presentation
 * (`sd_hash`), for this verifier and nonce, within the last five minutes.
 * Time checks allow 30 seconds of clock skew.
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
    const { kb, payload } = await sdjwt.verify(presentation, {
      expectedIssuer: getExpectedIssuer(),
      expectedVct: query.meta.vct_values,
      requiredClaimKeys: query.claims.map((claim) => encodePath(claim.path)),
      keyBindingNonce: expected.nonce,
      expectedKeyBindingAudience: expected.audience,
      keyBindingMaxAgeSeconds: MAX_KB_JWT_AGE_SECONDS,
      skewSeconds: CLOCK_SKEW_SECONDS,
    });
    // verify() skips holder binding without a nonce, and the status check
    // without a status reference; never accept either.
    if (!(kb && hasStatusListReference(payload))) {
      return null;
    }
    return await readDisclosedClaims(sdjwt, presentation);
  } catch {
    return null;
  }
}
