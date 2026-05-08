import { decodeJwt, type JWTVerifyOptions } from "jose";
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
 * Orthogonal-axes proof-of-human payload. RPs compose policy by reading the
 * axis they need; e.g. `verified human` = `identity.verified && humanity.proven`.
 *
 * The token is forward-portable; a downstream service can verify the
 * issuer signature plus the DPoP `cnf` thumbprint. No PII or per-RP
 * pseudonym appears in the PoH JWT.
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
export const IDENTITY_STRENGTH_TIERS: Record<IdentityEvidenceStrength, number> =
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
  dpopClient: Pick<DpopClient, "proofFor" | "withNonceRetry">;
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
  ok: true;
  token: string;
  unverifiedClaims: ProofOfHumanClaims;
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

export function parseProofOfHumanClaims(claims: unknown): ProofOfHumanClaims {
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

export function parseProofOfHumanConfirmation(
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

async function parseJsonBody(
  response: Response
): Promise<Record<string, unknown>> {
  return ((await response.json().catch(() => ({}))) ?? {}) as Record<
    string,
    unknown
  >;
}

export async function requestProofOfHumanToken(
  options: RequestProofOfHumanTokenOptions
): Promise<ProofOfHumanTokenRequestResult> {
  const proofOfHumanUrl =
    options.proofOfHumanUrl instanceof URL
      ? options.proofOfHumanUrl.toString()
      : options.proofOfHumanUrl;

  const { response, result } = await options.dpopClient.withNonceRetry(
    async (nonce) => {
      const proof = await options.dpopClient.proofFor(
        "POST",
        proofOfHumanUrl,
        options.accessToken,
        nonce
      );
      const response = await (options.fetch ?? fetch)(proofOfHumanUrl, {
        method: "POST",
        headers: {
          Authorization: `DPoP ${options.accessToken}`,
          DPoP: proof,
        },
      });
      const needsNonceRetry =
        (response.status === 400 || response.status === 401) &&
        Boolean(response.headers.get("DPoP-Nonce"));

      return {
        response,
        result: needsNonceRetry ? {} : await parseJsonBody(response),
      };
    }
  );

  if (!response.ok) {
    return {
      ok: false,
      error: (result.error as string | undefined) ?? "proof_of_human_failed",
      errorDescription:
        (result.error_description as string | undefined) ??
        `Issuer returned HTTP ${response.status}`,
      status: response.status,
    };
  }

  const token = result.token as string | undefined;
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
    unverifiedClaims: parseProofOfHumanClaims(payload.poh),
  };
}
