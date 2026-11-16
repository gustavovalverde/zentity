import {
  type DpopReplayStore,
  enforceDpopBinding,
  isDpopBindingError,
  parseAccessTokenAuthorization,
} from "@better-auth/core/oauth2";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeJwt,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";
import { z } from "zod";
import { canonicalJson } from "../protocol/authorization-details";
import {
  type IdentityStrength,
  IdentityStrengthSchema,
  meetsIdentityStrength,
  X402_PURCHASE_TYPE,
} from "../protocol/purchase-authorization";
import type { DpopClient } from "./dpop-client";
import {
  createJwksTokenVerifier,
  type JwksTokenVerifierOptions,
} from "./token-verifier";

/** The `typ` of every Zentity Proof-of-Human token. */
export const PROOF_OF_HUMAN_TOKEN_TYPE = "poh+jwt";

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
 * The `poh` claims of a merchant-mode token: only that the user's identity
 * meets the merchant's minimum.
 */
export interface MerchantProofOfHumanClaims {
  identity: { strength_at_least: IdentityStrength };
  policy: ProofOfHumanPolicyAxis;
}

export interface VerifiedProofOfHumanToken {
  /** The agent's pairwise subject, when a verified agent asked. */
  act?: { sub: string } | undefined;
  aud: string;
  /** The approved `x402_purchase` entry of a merchant-mode token. */
  authorizationDetails?: unknown[] | undefined;
  cnf: { jkt: string };
  exp: number;
  iat: number;
  jti: string;
  poh: ProofOfHumanClaims | MerchantProofOfHumanClaims;
  sub: string;
}

export interface ProofOfHumanTokenVerifier {
  verify(token: string): Promise<VerifiedProofOfHumanToken>;
}

export interface ProofOfHumanTokenVerifierOptions
  extends JwksTokenVerifierOptions {
  /**
   * The audience the token must name: a relying party's own `client_id` for a
   * client-mode token, a merchant's origin for a merchant-mode token.
   */
  audience: string;
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

/** Whether `poh` claims are a merchant-mode predicate. */
export function isMerchantProofOfHumanClaims(
  claims: ProofOfHumanClaims | MerchantProofOfHumanClaims
): claims is MerchantProofOfHumanClaims {
  return "strength_at_least" in claims.identity;
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

/**
 * The claims of a verified PoH token. A token without `jti`, `cnf.jkt`, or a
 * single string `aud` is refused: every Zentity PoH token has them.
 */
function readVerifiedClaims(payload: JWTPayload): VerifiedProofOfHumanToken {
  const cnf = parseProofOfHumanConfirmation(payload.cnf);
  if (
    typeof payload.sub !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.iat !== "number" ||
    typeof payload.jti !== "string" ||
    typeof payload.aud !== "string" ||
    !cnf
  ) {
    throw new Error(
      "Proof-of-human token missing sub, aud, iat, exp, jti, or cnf.jkt"
    );
  }
  const act =
    payload.act &&
    typeof payload.act === "object" &&
    typeof (payload.act as { sub?: unknown }).sub === "string"
      ? { sub: (payload.act as { sub: string }).sub }
      : undefined;
  return {
    sub: payload.sub,
    aud: payload.aud,
    iat: payload.iat,
    exp: payload.exp,
    jti: payload.jti,
    cnf,
    poh:
      parseMerchantProofOfHumanClaims(payload.poh) ??
      parseProofOfHumanClaims(payload.poh),
    ...(act ? { act } : {}),
    ...(Array.isArray(payload.authorization_details)
      ? { authorizationDetails: payload.authorization_details }
      : {}),
  };
}

/**
 * Verifies a PoH token's signature (EdDSA), issuer, `typ: poh+jwt`,
 * audience, and expiry, and reads its claims.
 */
export function createProofOfHumanTokenVerifier(
  options: ProofOfHumanTokenVerifierOptions
): ProofOfHumanTokenVerifier {
  const verifier = createJwksTokenVerifier(options);

  return {
    async verify(token: string): Promise<VerifiedProofOfHumanToken> {
      const { payload } = await verifier.verify(token, {
        algorithms: ["EdDSA"],
        audience: options.audience,
        typ: PROOF_OF_HUMAN_TOKEN_TYPE,
      });
      return readVerifiedClaims(payload);
    },
  };
}

// ─── Merchant presentation ──────────────────────────────────────────

/**
 * Where a merchant records the `jti` values it has seen: DPoP proof `jti`
 * values, and the PoH token's own `jti` once a payment verified. Share one
 * store across every instance that serves the resource.
 */
export interface ProofOfHumanReplayStore {
  /** Whether `key` was recorded and has not expired. */
  has(key: string): Promise<boolean> | boolean;
  /** Records `key` until `expiresAt`; false when it was already recorded. */
  reserve(reservation: {
    expiresAt: Date;
    key: string;
    now: Date;
  }): Promise<boolean> | boolean;
}

/**
 * An in-memory replay store for one merchant instance. A deployment with
 * more than one instance needs a shared store instead.
 */
export function createInMemoryProofOfHumanReplayStore(): ProofOfHumanReplayStore {
  const entries = new Map<string, number>();
  const prune = (now: number) => {
    for (const [key, expiresAt] of entries) {
      if (expiresAt <= now) {
        entries.delete(key);
      }
    }
  };
  return {
    has(key) {
      const expiresAt = entries.get(key);
      return expiresAt !== undefined && expiresAt > Date.now();
    },
    reserve({ key, expiresAt, now }) {
      prune(now.getTime());
      if (entries.has(key)) {
        return false;
      }
      entries.set(key, expiresAt.getTime());
      return true;
    },
  };
}

export type ProofOfHumanPresentationErrorCode =
  | "invalid_token"
  | "invalid_dpop_proof"
  | "insufficient_identity_strength"
  | "approval_mismatch";

/**
 * Why a merchant refuses a PoH presentation. `status` is the HTTP status to
 * answer with, and `wwwAuthenticate` the challenge for a 401.
 */
export class ProofOfHumanPresentationError extends Error {
  readonly code: ProofOfHumanPresentationErrorCode;
  readonly status: 401 | 403;

  constructor(code: ProofOfHumanPresentationErrorCode, message: string) {
    super(message);
    this.name = "ProofOfHumanPresentationError";
    this.code = code;
    this.status =
      code === "invalid_token" || code === "invalid_dpop_proof" ? 401 : 403;
  }

  /** The `WWW-Authenticate` value for a 401, RFC 9449 §7.1. */
  get wwwAuthenticate(): string | undefined {
    return this.status === 401
      ? `DPoP error="${this.code}", algs="ES256"`
      : undefined;
  }
}

const POH_REPLAY_PREFIX = "poh:";
const DPOP_REPLAY_PREFIX = "dpop:";

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function resolveKeySet(
  jwks: string | URL | JSONWebKeySet | JWTVerifyGetKey
): JWTVerifyGetKey {
  if (typeof jwks === "function") {
    return jwks;
  }
  if (typeof jwks === "string" || jwks instanceof URL) {
    const url = String(jwks);
    const cached = remoteKeySets.get(url);
    if (cached) {
      return cached;
    }
    const keySet = createRemoteJWKSet(new URL(url));
    remoteKeySets.set(url, keySet);
    return keySet;
  }
  return createLocalJWKSet(jwks);
}

function dpopReplayStore(store: ProofOfHumanReplayStore): DpopReplayStore {
  return {
    reserve: ({ key, expiresAt, now }) =>
      store.reserve({ key: `${DPOP_REPLAY_PREFIX}${key}`, expiresAt, now }),
  };
}

export interface VerifyProofOfHumanPresentationOptions {
  /** The merchant's origin, which a merchant-mode token names as `aud`. */
  audience: string;
  /** The Zentity issuer (`iss` of the token), the app origin. */
  issuer: string;
  /** Zentity's JWKS: its URL, the key set, or a jose key resolver. */
  jwks: string | URL | JSONWebKeySet | JWTVerifyGetKey;
  replayStore: ProofOfHumanReplayStore;
  request: Request;
  /**
   * The URL the agent signed the DPoP proof for, when `request.url` is not
   * the public URL (for example behind a proxy).
   */
  url?: string;
}

/**
 * The first two merchant checks on a request with a PoH token, without
 * spending it: the token's signature, `iss`, `typ`, `aud`, `exp`, and an
 * unused `jti` (read only); then the DPoP proof (`htm`, `htu`, `iat`, `ath`,
 * the key equal to `cnf.jkt`), whose `jti` is recorded. Record the token's
 * own `jti` with {@link recordProofOfHumanUse} only after the payment
 * verifies, so a refused payment does not spend the approval.
 */
export async function verifyProofOfHumanPresentation(
  options: VerifyProofOfHumanPresentationOptions
): Promise<VerifiedProofOfHumanToken> {
  const authorization = parseAccessTokenAuthorization(
    options.request.headers.get("authorization") ?? undefined
  );
  if (authorization?.scheme !== "DPoP" || !authorization.token) {
    throw new ProofOfHumanPresentationError(
      "invalid_token",
      "Present a proof-of-human token with the DPoP scheme"
    );
  }

  let claims: VerifiedProofOfHumanToken;
  try {
    const { payload } = await jwtVerify(
      authorization.token,
      resolveKeySet(options.jwks),
      {
        algorithms: ["EdDSA"],
        audience: options.audience,
        issuer: options.issuer,
        typ: PROOF_OF_HUMAN_TOKEN_TYPE,
      }
    );
    claims = readVerifiedClaims(payload);
  } catch {
    throw new ProofOfHumanPresentationError(
      "invalid_token",
      "The proof-of-human token is not valid for this merchant"
    );
  }
  if (
    await options.replayStore.has(`${POH_REPLAY_PREFIX}${claims.jti}`)
  ) {
    throw new ProofOfHumanPresentationError(
      "invalid_token",
      "The proof-of-human token was already used"
    );
  }

  try {
    await enforceDpopBinding({
      payload: { cnf: claims.cnf },
      authorization,
      proofJwt: options.request.headers.get("dpop"),
      method: options.request.method,
      url: options.url ?? options.request.url,
      replayStore: dpopReplayStore(options.replayStore),
      signingAlgorithms: ["ES256"],
    });
  } catch (error) {
    if (isDpopBindingError(error)) {
      throw new ProofOfHumanPresentationError(
        error.code === "invalid_token" ? "invalid_token" : "invalid_dpop_proof",
        error.message
      );
    }
    throw error;
  }
  return claims;
}

/**
 * The third merchant check: the token states at least the merchant's
 * minimum identity strength.
 */
export function assertIdentityStrength(
  claims: VerifiedProofOfHumanToken,
  minimum: IdentityStrength
): void {
  const strength = isMerchantProofOfHumanClaims(claims.poh)
    ? claims.poh.identity.strength_at_least
    : claims.poh.identity.strength;
  if (!meetsIdentityStrength(strength, minimum)) {
    throw new ProofOfHumanPresentationError(
      "insufficient_identity_strength",
      `This resource requires ${minimum} identity verification`
    );
  }
}

function canonicalEquals(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

/**
 * The fourth merchant check: the approved `payment_requirements` equal the
 * route's requirement and the payment's `accepted` requirement, and the
 * approved `resource_url` is the URL of this resource.
 */
export function assertApprovedRequirement(
  claims: VerifiedProofOfHumanToken,
  routeRequirement: unknown,
  paymentPayload: { accepted?: unknown },
  resourceUrl: string
): void {
  const [entry, ...rest] = claims.authorizationDetails ?? [];
  const approved = entry as
    | { payment_requirements?: unknown; resource_url?: unknown; type?: unknown }
    | undefined;
  if (
    !approved ||
    rest.length > 0 ||
    approved.type !== X402_PURCHASE_TYPE ||
    approved.resource_url !== resourceUrl ||
    !canonicalEquals(approved.payment_requirements, routeRequirement) ||
    !canonicalEquals(paymentPayload.accepted, routeRequirement)
  ) {
    throw new ProofOfHumanPresentationError(
      "approval_mismatch",
      "The approved terms differ from this resource's payment"
    );
  }
}

/**
 * The sixth merchant check, after the facilitator verified the payment:
 * records the token's `jti` until it expires. A token already recorded is
 * refused, so one approval pays once.
 */
export async function recordProofOfHumanUse(
  claims: Pick<VerifiedProofOfHumanToken, "exp" | "jti">,
  replayStore: ProofOfHumanReplayStore
): Promise<void> {
  const recorded = await replayStore.reserve({
    key: `${POH_REPLAY_PREFIX}${claims.jti}`,
    expiresAt: new Date(claims.exp * 1000),
    now: new Date(),
  });
  if (!recorded) {
    throw new ProofOfHumanPresentationError(
      "invalid_token",
      "The proof-of-human token was already used"
    );
  }
}

// ─── Requesting a token ─────────────────────────────────────────────

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
