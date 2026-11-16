import "server-only";

import type { ProtectedResourcePrincipal } from "./resource-principal";

import crypto from "node:crypto";

import {
  meetsIdentityStrength,
  X402_PURCHASE_TYPE,
  type X402PurchaseAuthorization,
  X402PurchaseAuthorizationSchema,
} from "@zentity/sdk/protocol";
import { and, eq, isNull } from "drizzle-orm";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { cibaApprovals } from "@/lib/db/schema/ciba";
import {
  currentIdentityStrength,
  getVerificationReadModel,
} from "@/lib/identity/verification/read-model";

import { signJwt } from "./jwt-signer";
import { pairwiseValue, tokenSector } from "./pairwise";

/**
 * Mints Proof-of-Human (`poh+jwt`) tokens. The presenting access token picks
 * the mode; the caller has no audience to choose.
 *
 * - Merchant mode: the token came from an `x402_purchase` CIBA approval. The
 *   PoH token is for that merchant only (`aud` is the origin of the approved
 *   `resource_url`), names the user and agent with subjects pairwise for the
 *   client and merchant together, states only that the user's identity meets
 *   the merchant's minimum, lives at most 300 seconds, and is minted once per
 *   approval.
 * - Client mode: any other `poh` token. The PoH token is for the client
 *   itself and carries the user's identity and humanity axes.
 *
 * Both are DPoP-bound to the presenting token's key, so a merchant needs the
 * agent's per-purchase key to use one.
 */

const POH_TOKEN_TYPE = "poh+jwt";
const MAX_LIFETIME_SECONDS = 300;
const TRAILING_SLASHES = /\/+$/;

export type ProofOfHumanMintResult =
  | { expiresIn: number; ok: true; token: string }
  | {
      error: "insufficient_scope" | "invalid_token" | "not_verified";
      ok: false;
    };

function issuer(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASHES, "");
}

function detailType(entry: unknown): unknown {
  return entry && typeof entry === "object"
    ? (entry as { type?: unknown }).type
    : undefined;
}

/**
 * The approved `x402_purchase` entry when the token carries exactly that one
 * entry, null for a token with no purchase entry, and "invalid" for anything
 * else, which a pinned request cannot produce.
 */
function merchantEntry(
  details: unknown[]
): X402PurchaseAuthorization | null | "invalid" {
  const purchases = details.filter(
    (entry) => detailType(entry) === X402_PURCHASE_TYPE
  );
  if (purchases.length === 0) {
    return null;
  }
  if (details.length !== 1) {
    return "invalid";
  }
  const parsed = X402PurchaseAuthorizationSchema.safeParse(purchases[0]);
  return parsed.success ? parsed.data : "invalid";
}

async function mintForMerchant(
  principal: ProtectedResourcePrincipal,
  entry: X402PurchaseAuthorization
): Promise<ProofOfHumanMintResult> {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.min(
    now + MAX_LIFETIME_SECONDS,
    now + entry.payment_requirements.maxTimeoutSeconds,
    principal.exp
  );
  if (!principal.referenceId || exp <= now) {
    return { ok: false, error: "invalid_token" };
  }

  // Read-only check first, so a refused mint leaves the approval unspent.
  const model = await getVerificationReadModel(principal.userId);
  if (
    !meetsIdentityStrength(
      currentIdentityStrength(model),
      entry.min_identity_strength
    )
  ) {
    return { ok: false, error: "invalid_token" };
  }

  const jti = crypto.randomBytes(16).toString("base64url");
  const [record] = await db
    .update(cibaApprovals)
    .set({ pohMintedAt: new Date(), pohJti: jti })
    .where(
      and(
        eq(cibaApprovals.referenceId, principal.referenceId),
        eq(cibaApprovals.userId, principal.userId),
        eq(cibaApprovals.clientId, principal.clientId),
        eq(cibaApprovals.decision, "approved"),
        isNull(cibaApprovals.pohMintedAt)
      )
    )
    .returning({ agentSessionId: cibaApprovals.agentSessionId });
  if (!record) {
    return { ok: false, error: "invalid_token" };
  }

  const merchant = new URL(entry.resource_url).origin;
  // Pairwise for every client, including one with a public subject type or
  // the public agent opt-out: the merchant is not the client.
  const sector = tokenSector(principal.client, merchant);
  const { resource_description: _shownToTheUserOnly, ...approved } = entry;

  const token = await signJwt(
    {
      iss: issuer(),
      sub: await pairwiseValue(sector, principal.userId),
      aud: merchant,
      iat: now,
      exp,
      jti,
      scope: "poh",
      cnf: { jkt: principal.dpopJkt },
      ...(record.agentSessionId
        ? {
            act: {
              sub: await pairwiseValue(sector, record.agentSessionId),
              sub_profile: "service",
            },
          }
        : {}),
      poh: {
        identity: { strength_at_least: entry.min_identity_strength },
        policy: { version: model.compliance.policy.version },
      },
      authorization_details: [approved],
    },
    { typ: POH_TOKEN_TYPE }
  );
  return { ok: true, token, expiresIn: exp - now };
}

async function mintForClient(
  principal: ProtectedResourcePrincipal
): Promise<ProofOfHumanMintResult> {
  const { compliance } = await getVerificationReadModel(principal.userId);
  // A user with humanity alone still gets a token; a client that needs a
  // verified identity reads `identity.verified`.
  if (!(compliance.identity.verified || compliance.humanity.proven)) {
    return { ok: false, error: "not_verified" };
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    {
      iss: issuer(),
      sub: principal.sub,
      aud: principal.clientId,
      iat: now,
      exp: now + MAX_LIFETIME_SECONDS,
      jti: crypto.randomBytes(16).toString("base64url"),
      scope: "poh",
      cnf: { jkt: principal.dpopJkt },
      poh: {
        identity: {
          verified: compliance.identity.verified,
          strength: compliance.identity.strength,
        },
        humanity: { proven: compliance.humanity.proven },
        policy: { version: compliance.policy.version },
      },
    },
    { typ: POH_TOKEN_TYPE }
  );
  return { ok: true, token, expiresIn: MAX_LIFETIME_SECONDS };
}

/** Mints the Proof-of-Human token the presenting access token allows. */
export function mintProofOfHuman(
  principal: ProtectedResourcePrincipal
): Promise<ProofOfHumanMintResult> {
  if (!principal.scopes.includes("poh")) {
    return Promise.resolve({ ok: false, error: "insufficient_scope" });
  }
  const entry = merchantEntry(principal.authorizationDetails);
  if (entry === "invalid") {
    return Promise.resolve({ ok: false, error: "invalid_token" });
  }
  return entry ? mintForMerchant(principal, entry) : mintForClient(principal);
}
