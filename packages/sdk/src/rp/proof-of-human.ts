import { decodeJwt, type JWTVerifyOptions } from "jose";
import { z } from "zod";
import {
  type IdentityStrength,
  IdentityStrengthSchema,
} from "../protocol/purchase-authorization";
import type { DpopClient } from "./dpop-client";
import {
  createJwksTokenVerifier,
  type JwksTokenVerifierOptions,
} from "./token-verifier";

export type IdentityEvidenceStrength =
  | "none"
  | "documentary"
  | "documentary_full"
  | "cryptographic_chip";

export interface ProofOfHumanIdentityAxis {
  strength: IdentityEvidenceStrength;
  verified: boolean;
}

export interface ProofOfHumanHumanityAxis {
  proven: boolean;
}

export interface ProofOfHumanPolicyAxis {
  version: string;
}

/**
 * The axes of a client-mode proof-of-human token. RPs compose policy by
 * reading the axis they need; e.g. `verified human` =
 * `identity.verified && humanity.proven`.
 *
 * A client-mode token is audienced to the client that requested it and names
 * the user by that client's subject; it carries no PII.
 */
export interface ProofOfHumanClaims {
  humanity: ProofOfHumanHumanityAxis;
  identity: ProofOfHumanIdentityAxis;
  policy: ProofOfHumanPolicyAxis;
}

/**
 * uint8 ladder mapping identity-evidence strength to an integer for callers
 * that compare a numeric threshold (e.g. `minComplianceLevel`). Mirrors the
 * issuer-side `COMPLIANCE_ONCHAIN_TIERS` constant so RP and chain agree on
 * what each tier means.
 */
const IDENTITY_STRENGTH_TIERS: Record<IdentityEvidenceStrength, number> =
  {
    none: 0,
    documentary: 1,
    documentary_full: 2,
    cryptographic_chip: 3,
  };

export function identityStrengthTier(claims: ProofOfHumanClaims): number {
  return IDENTITY_STRENGTH_TIERS[claims.identity.strength];
}

export interface VerifiedProofOfHumanToken {
  cnf?: { jkt: string } | undefined;
  exp: number;
  poh: ProofOfHumanClaims;
  sub: string;
}

export interface ProofOfHumanTokenVerifier {
  verify(
    token: string,
    options?: JWTVerifyOptions
  ): Promise<VerifiedProofOfHumanToken>;
}

export interface RequestProofOfHumanTokenOptions {
  accessToken: string;
  dpopClient: Pick<DpopClient, "fetch">;
  fetch?: typeof globalThis.fetch;
  proofOfHumanUrl: string | URL;
}

export interface ProofOfHumanTokenRequestFailure {
  error: string;
  errorDescription?: string | undefined;
  ok: false;
  status: number;
}

export interface ProofOfHumanTokenRequestSuccess {
  confirmationJkt: string | null;
  /** Seconds the token lives, as the issuer stated it. */
  expiresIn: number | null;
  ok: true;
  token: string;
  /**
   * The token's `poh` claims, read without verifying the signature: the
   * client-mode axes, or a merchant-mode predicate.
   */
  unverifiedClaims: ProofOfHumanClaims | MerchantProofOfHumanClaims;
}

export type ProofOfHumanTokenRequestResult =
  | ProofOfHumanTokenRequestFailure
  | ProofOfHumanTokenRequestSuccess;

const VALID_STRENGTHS = new Set<IdentityEvidenceStrength>([
  "none",
  "documentary",
  "documentary_full",
  "cryptographic_chip",
]);

function asStrength(value: unknown): IdentityEvidenceStrength {
  return typeof value === "string" && VALID_STRENGTHS.has(value as never)
    ? (value as IdentityEvidenceStrength)
    : "none";
}

/**
 * The `poh` claims of a merchant-mode token: only that the user's identity
 * meets the merchant's minimum.
 */
export interface MerchantProofOfHumanClaims {
  identity: { strength_at_least: IdentityStrength };
  policy: ProofOfHumanPolicyAxis;
}

const merchantClaimsSchema = z
  .object({
    identity: z.object({ strength_at_least: IdentityStrengthSchema }).strict(),
    policy: z.object({ version: z.string() }).strict(),
  })
  .strict();

/** Reads merchant-mode `poh` claims, or null for any other shape. */
export function parseMerchantProofOfHumanClaims(
  claims: unknown
): MerchantProofOfHumanClaims | null {
  const parsed = merchantClaimsSchema.safeParse(claims);
  return parsed.success ? parsed.data : null;
}

function parseProofOfHumanClaims(claims: unknown): ProofOfHumanClaims {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    throw new Error("Proof-of-human token missing poh claim");
  }

  const root = claims as Record<string, unknown>;
  const identity = (root.identity ?? {}) as Record<string, unknown>;
  const humanity = (root.humanity ?? {}) as Record<string, unknown>;
  const policy = (root.policy ?? {}) as Record<string, unknown>;

  if (
    typeof identity.verified !== "boolean" ||
    typeof humanity.proven !== "boolean"
  ) {
    throw new Error("Proof-of-human token missing required axis flags");
  }

  return {
    identity: {
      verified: identity.verified,
      strength: asStrength(identity.strength),
    },
    humanity: {
      proven: humanity.proven,
    },
    policy: {
      version: typeof policy.version === "string" ? policy.version : "v1.0",
    },
  };
}

function parseProofOfHumanConfirmation(
  confirmation: unknown
): { jkt: string } | undefined {
  if (
    !confirmation ||
    typeof confirmation !== "object" ||
    Array.isArray(confirmation)
  ) {
    return undefined;
  }

  const jkt = (confirmation as Record<string, unknown>).jkt;
  return typeof jkt === "string" ? { jkt } : undefined;
}

export function createProofOfHumanTokenVerifier(
  options: JwksTokenVerifierOptions
): ProofOfHumanTokenVerifier {
  const verifier = createJwksTokenVerifier(options);

  return {
    async verify(
      token: string,
      verifyOptions: JWTVerifyOptions = {}
    ): Promise<VerifiedProofOfHumanToken> {
      const proofOfHumanVerifyOptions = { ...verifyOptions };
      proofOfHumanVerifyOptions.algorithms ??= ["EdDSA"];

      const { payload } = await verifier.verify(token, proofOfHumanVerifyOptions);
      if (typeof payload.sub !== "string" || typeof payload.exp !== "number") {
        throw new Error("Proof-of-human token missing sub or exp claim");
      }

      return {
        sub: payload.sub,
        exp: payload.exp,
        poh: parseProofOfHumanClaims(payload.poh),
        cnf: parseProofOfHumanConfirmation(payload.cnf),
      };
    },
  };
}

const proofOfHumanResponseSchema = z.object({
  error: z.string().optional().catch(undefined),
  error_description: z.string().optional().catch(undefined),
  expires_in: z.number().optional().catch(undefined),
  token: z.string().optional().catch(undefined),
});

export async function requestProofOfHumanToken(
  options: RequestProofOfHumanTokenOptions
): Promise<ProofOfHumanTokenRequestResult> {
  const response = await options.dpopClient.fetch(options.proofOfHumanUrl, {
    method: "POST",
    accessToken: options.accessToken,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const result =
    proofOfHumanResponseSchema.safeParse(
      await response.json().catch(() => undefined)
    ).data ?? {};

  if (!response.ok) {
    return {
      ok: false,
      error: result.error ?? "proof_of_human_failed",
      errorDescription:
        result.error_description ?? `Issuer returned HTTP ${response.status}`,
      status: response.status,
    };
  }

  const token = result.token;
  if (!token) {
    return {
      ok: false,
      error: "no_token_in_response",
      status: 502,
    };
  }

  const payload = decodeJwt(token);
  return {
    ok: true,
    token,
    confirmationJkt: parseProofOfHumanConfirmation(payload.cnf)?.jkt ?? null,
    expiresIn: result.expires_in ?? null,
    unverifiedClaims:
      parseMerchantProofOfHumanClaims(payload.poh) ??
      parseProofOfHumanClaims(payload.poh),
  };
}
