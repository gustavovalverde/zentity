/**
 * Humanity provider registry.
 *
 * Adding a provider does not require a DB migration:
 * `humanity_credentials.provider` is an open `text` column.
 */

import "server-only";

import {
  HumanityProviderDisabledError,
  HumanityProviderNotFoundError,
} from "./errors";
import {
  WORLD_ID_DEVICE_PROVIDER,
  WORLD_ID_DOCUMENT_PROVIDER,
  WORLD_ID_ORB_PROVIDER,
} from "./providers/world-id";

// ─── Types ───────────────────────────────────────────────────────────

/**
 * The kind of evidence a provider produces, used by RPs and the on-chain
 * encoder to decide policy. Open to extension.
 */
export type HumanityEvidenceStrength =
  | "biometric" // iris/face/palm hardware-attested liveness
  | "documentary" // government-document NFC chip read
  | "device" // phone secure element / WebAuthn-class
  | "social_graph" // peer-attested (BrightID, Proof of Humanity)
  | "score"; // aggregator threshold (Gitcoin Passport)

/**
 * A request to verify a provider proof. The provider entry decides what
 * fields it reads — input is intentionally `unknown` at the dispatcher
 * layer; the provider's own Zod schema validates.
 */
export interface HumanityVerifyRequest {
  expectedNonce: string;
  expectedSignal: string;
  fetchImpl?: typeof fetch;
  proof: unknown;
}

/**
 * Successful verification produces a raw provider identifier (nullifier,
 * registry-entry id, score-threshold token, etc.) plus the kind of subject
 * it represents. The orchestrator HMACs the raw subject before storing.
 */
export interface HumanityVerifyResult {
  expiresAt?: string;
  providerMetadata?: Record<string, unknown>;
  providerSubject: string;
  providerSubjectKind: string;
}

/**
 * Provider-specific challenge payload returned to the client. Shape is
 * provider-defined; the orchestrator only needs the nonce to bind the
 * challenge to the eventual proof.
 */
export interface HumanityChallengeOutput {
  expiresAt: string;
  nonce: string;
  payload: Record<string, unknown>;
}

export interface HumanityProviderEntry {
  /** Mint a fresh challenge (nonce + provider-specific payload). */
  buildChallenge(): Promise<HumanityChallengeOutput>;
  /** One-line description for consent screens and provider listings. */
  readonly description: string;
  /** Short label for UI surfaces. */
  readonly displayName: string;
  /** True iff every required env var is present and feature flag is on. */
  enabled(): boolean;
  /** Evidence-strength classification used by RP policies. */
  readonly evidenceStrength: HumanityEvidenceStrength;
  /** Stable identifier; persists in DB. Lower-snake-case. */
  readonly id: string;
  /** Env var names that must be set for `enabled()` to return true. */
  readonly requiredEnv: readonly string[];
  /** What the `provider_subject_hash` commits to (e.g. `"nullifier"`). */
  readonly subjectKind: string;
  /** Verify a submitted proof; throw on any verification failure. */
  verifyProof(request: HumanityVerifyRequest): Promise<HumanityVerifyResult>;
}

// ─── Registry ────────────────────────────────────────────────────────

const ENTRIES = [
  WORLD_ID_ORB_PROVIDER,
  WORLD_ID_DOCUMENT_PROVIDER,
  WORLD_ID_DEVICE_PROVIDER,
] as const satisfies readonly HumanityProviderEntry[];

const REGISTRY_INDEX = new Map<string, HumanityProviderEntry>(
  ENTRIES.map((entry) => [entry.id, entry])
);

/**
 * Resolve a provider id and assert it is enabled in the current deployment.
 * Throws `HumanityProviderNotFoundError` for unknown ids and
 * `HumanityProviderDisabledError` when env is missing.
 */
export function requireEnabledProvider(
  providerId: string
): HumanityProviderEntry {
  const entry = REGISTRY_INDEX.get(providerId) ?? null;
  if (!entry) {
    throw new HumanityProviderNotFoundError(providerId);
  }
  if (!entry.enabled()) {
    throw new HumanityProviderDisabledError(providerId);
  }
  return entry;
}
