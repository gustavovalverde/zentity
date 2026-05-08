import "server-only";

import type { RpContext } from "@worldcoin/idkit";
import type {
  HumanityChallengeOutput,
  HumanityEvidenceStrength,
  HumanityProviderEntry,
  HumanityVerifyRequest,
  HumanityVerifyResult,
} from "../registry";

import { hashSignal } from "@worldcoin/idkit/hashing";
import { signRequest } from "@worldcoin/idkit/signing";
import { z } from "zod";

import { env } from "@/env";

import {
  HumanityProofVerificationError,
  HumanityProviderConfigurationError,
} from "../errors";

const WORLD_ID_ACTION = "zentity-link-humanity";
const VERIFY_TIMEOUT_MS = 10_000;
const WORLD_ID_REQUIRED_ENV = [
  "NEXT_PUBLIC_WORLD_ID_ENABLED",
  "NEXT_PUBLIC_WORLD_ID_APP_ID",
  "WORLD_ID_RP_ID",
  "WORLD_ID_RP_SIGNING_KEY",
] as const;

// ─── Errors (extend the base humanity errors so the route layer is generic) ──

class WorldIdConfigurationError extends HumanityProviderConfigurationError {
  constructor(message: string) {
    super(message);
    this.name = "WorldIdConfigurationError";
  }
}

class WorldIdVerificationError extends HumanityProofVerificationError {
  constructor(message: string, status = 400) {
    super(message, status);
    this.name = "WorldIdVerificationError";
  }
}

// ─── Wire-format schemas ─────────────────────────────────────────────

const responseItemV3Schema = z.object({
  identifier: z.string().min(1),
  proof: z.string().min(1),
  merkle_root: z.string().min(1),
  nullifier: z.string().min(1),
  signal_hash: z.string().optional(),
});

const responseItemV4Schema = z.object({
  identifier: z.string().min(1),
  proof: z.array(z.string().min(1)).min(1),
  nullifier: z.string().min(1),
  issuer_schema_id: z.number(),
  expires_at_min: z.number(),
  signal_hash: z.string().optional(),
});

const worldIdProofSchema = z.discriminatedUnion("protocol_version", [
  z.object({
    protocol_version: z.literal("3.0"),
    nonce: z.string().min(1),
    action: z.string().min(1),
    action_description: z.string().optional(),
    responses: z.array(responseItemV3Schema).length(1),
    environment: z.enum(["production", "staging"]),
  }),
  z.object({
    protocol_version: z.literal("4.0"),
    nonce: z.string().min(1),
    action: z.string().min(1),
    action_description: z.string().optional(),
    responses: z.array(responseItemV4Schema).length(1),
    environment: z.enum(["production", "staging"]),
  }),
]);

const verifyResponseSchema = z.object({
  success: z.literal(true),
  results: z
    .array(
      z.object({
        identifier: z.string().optional(),
        success: z.literal(true),
      })
    )
    .min(1),
  action: z.string().optional(),
  environment: z.enum(["production", "staging"]).optional(),
});

// ─── Config & enabled() ──────────────────────────────────────────────

function isWorldIdConfigured(): boolean {
  return Boolean(
    env.NEXT_PUBLIC_WORLD_ID_ENABLED &&
      env.NEXT_PUBLIC_WORLD_ID_APP_ID &&
      env.WORLD_ID_RP_ID &&
      env.WORLD_ID_RP_SIGNING_KEY
  );
}

function getWorldIdServerConfig() {
  if (!env.NEXT_PUBLIC_WORLD_ID_ENABLED) {
    throw new WorldIdConfigurationError("World ID is disabled");
  }
  if (!env.NEXT_PUBLIC_WORLD_ID_APP_ID) {
    throw new WorldIdConfigurationError("World ID app ID is not configured");
  }
  if (!env.WORLD_ID_RP_ID) {
    throw new WorldIdConfigurationError("World ID RP ID is not configured");
  }
  if (!env.WORLD_ID_RP_SIGNING_KEY) {
    throw new WorldIdConfigurationError(
      "World ID RP signing key is not configured"
    );
  }

  return {
    appId: env.NEXT_PUBLIC_WORLD_ID_APP_ID,
    environment: env.WORLD_ID_ENVIRONMENT,
    rpId: env.WORLD_ID_RP_ID,
    signingKey: env.WORLD_ID_RP_SIGNING_KEY,
    signatureTtlSeconds: env.WORLD_ID_RP_SIGNATURE_TTL_SECONDS,
    verifyUrl: env.WORLD_ID_VERIFY_URL,
  };
}

// ─── Challenge ───────────────────────────────────────────────────────

interface WorldIdChallengePayload {
  action: typeof WORLD_ID_ACTION;
  appId: `app_${string}`;
  environment: "production" | "staging";
  rpContext: RpContext;
}

function buildWorldIdChallenge(): Promise<HumanityChallengeOutput> {
  const config = getWorldIdServerConfig();
  const signature = signRequest({
    signingKeyHex: config.signingKey,
    action: WORLD_ID_ACTION,
    ttl: config.signatureTtlSeconds,
  });

  const payload: WorldIdChallengePayload = {
    action: WORLD_ID_ACTION,
    appId: config.appId as `app_${string}`,
    environment: config.environment,
    rpContext: {
      rp_id: config.rpId,
      nonce: signature.nonce,
      created_at: signature.createdAt,
      expires_at: signature.expiresAt,
      signature: signature.sig,
    },
  };

  return Promise.resolve({
    nonce: signature.nonce,
    expiresAt: new Date(signature.expiresAt * 1000).toISOString(),
    payload: payload as unknown as Record<string, unknown>,
  });
}

// ─── Verification ────────────────────────────────────────────────────

/**
 * IDKit returns a per-response `identifier` indicating which verification
 * level produced the proof. We map it to our provider id so the credential
 * is filed under the right level. A widget configured for one level will
 * only ever return proofs at that level, but the server still asserts.
 */
const WORLD_ID_LEVEL_BY_IDENTIFIER: Record<string, string> = {
  orb: "world_id_orb",
  proof_of_human: "world_id_orb",
  document: "world_id_document",
  device: "world_id_device",
};

function makeWorldIdVerifier(expectedProviderId: string) {
  return async function verifyProof(
    request: HumanityVerifyRequest
  ): Promise<HumanityVerifyResult> {
    const config = getWorldIdServerConfig();

    const parseResult = worldIdProofSchema.safeParse(request.proof);
    if (!parseResult.success) {
      throw new WorldIdVerificationError("Invalid World ID proof shape");
    }
    const proof = parseResult.data;

    if (proof.environment !== config.environment) {
      throw new WorldIdVerificationError("World ID environment mismatch");
    }
    if (proof.action !== WORLD_ID_ACTION) {
      throw new WorldIdVerificationError("World ID action mismatch");
    }
    if (proof.nonce !== request.expectedNonce) {
      throw new WorldIdVerificationError("World ID nonce mismatch");
    }

    const first = proof.responses[0];
    if (!first) {
      throw new WorldIdVerificationError("World ID proof has no responses");
    }
    const expectedSignalHash = hashSignal(request.expectedSignal);
    if (first.signal_hash !== expectedSignalHash) {
      throw new WorldIdVerificationError("World ID signal mismatch");
    }

    const declaredLevel = WORLD_ID_LEVEL_BY_IDENTIFIER[first.identifier];
    if (declaredLevel !== expectedProviderId) {
      throw new WorldIdVerificationError(
        `World ID verification level mismatch: expected ${expectedProviderId}, got ${first.identifier}`
      );
    }

    const fetchImpl = request.fetchImpl ?? fetch;
    const response = await fetchImpl(`${config.verifyUrl}/${config.rpId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "world-id-verifier/1.0",
      },
      body: JSON.stringify(proof),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new WorldIdVerificationError(
        "World ID verification failed",
        response.status
      );
    }

    const payload = await response.json().catch(() => null);
    const parsed = verifyResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new WorldIdVerificationError(
        "Invalid World ID verification response"
      );
    }

    const metadata: Record<string, unknown> = {
      protocol_version: proof.protocol_version,
      verification_level: first.identifier,
    };
    if ("issuer_schema_id" in first) {
      metadata.issuer_schema_id = first.issuer_schema_id;
    }
    if ("expires_at_min" in first) {
      metadata.expires_at_min = first.expires_at_min;
    }

    return {
      providerSubject: first.nullifier,
      providerSubjectKind: "nullifier",
      providerMetadata: metadata,
    };
  };
}

// ─── Provider entries ────────────────────────────────────────────────

function makeWorldIdProvider(args: {
  id: string;
  displayName: string;
  description: string;
  evidenceStrength: HumanityEvidenceStrength;
}): HumanityProviderEntry {
  return {
    id: args.id,
    displayName: args.displayName,
    description: args.description,
    evidenceStrength: args.evidenceStrength,
    subjectKind: "nullifier",
    requiredEnv: WORLD_ID_REQUIRED_ENV,
    enabled: isWorldIdConfigured,
    buildChallenge: buildWorldIdChallenge,
    verifyProof: makeWorldIdVerifier(args.id),
  };
}

export const WORLD_ID_ORB_PROVIDER = makeWorldIdProvider({
  id: "world_id_orb",
  displayName: "World ID (Orb)",
  description: "Iris-biometric uniqueness proof from a Worldcoin Orb",
  evidenceStrength: "biometric",
});

export const WORLD_ID_DOCUMENT_PROVIDER = makeWorldIdProvider({
  id: "world_id_document",
  displayName: "World ID (Passport)",
  description: "Document-NFC uniqueness proof via the World App",
  evidenceStrength: "documentary",
});

export const WORLD_ID_DEVICE_PROVIDER = makeWorldIdProvider({
  id: "world_id_device",
  displayName: "World ID (Device)",
  description: "Device-secure-element uniqueness proof via the World App",
  evidenceStrength: "device",
});
