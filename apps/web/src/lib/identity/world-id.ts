import "server-only";

import type { RpContext } from "@worldcoin/idkit";

import { hashSignal } from "@worldcoin/idkit/hashing";
import { signRequest } from "@worldcoin/idkit/signing";
import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/env";

const WORLD_ID_ACTION = "zentity-link-human-signal";
const VERIFY_TIMEOUT_MS = 10_000;

export class WorldIdConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldIdConfigurationError";
  }
}

export class WorldIdVerificationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "WorldIdVerificationError";
    this.status = status;
  }
}

export function worldIdUnavailableResponse(): Response {
  return NextResponse.json({ error: "world_id_unavailable" }, { status: 503 });
}

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

export const worldIdProofSchema = z.discriminatedUnion("protocol_version", [
  z.object({
    protocol_version: z.literal("3.0"),
    nonce: z.string().min(1),
    action: z.string().min(1),
    action_description: z.string().optional(),
    responses: z.array(responseItemV3Schema).min(1),
    environment: z.enum(["production", "staging"]),
  }),
  z.object({
    protocol_version: z.literal("4.0"),
    nonce: z.string().min(1),
    action: z.string().min(1),
    action_description: z.string().optional(),
    responses: z.array(responseItemV4Schema).min(1),
    environment: z.enum(["production", "staging"]),
  }),
]);

export type WorldIdProof = z.infer<typeof worldIdProofSchema>;

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

export function buildWorldIdRequest(): {
  action: typeof WORLD_ID_ACTION;
  appId: `app_${string}`;
  environment: "production" | "staging";
  rpContext: RpContext;
} {
  const config = getWorldIdServerConfig();
  const signature = signRequest({
    signingKeyHex: config.signingKey,
    action: WORLD_ID_ACTION,
    ttl: config.signatureTtlSeconds,
  });

  return {
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
}

export async function verifyWorldIdProof(args: {
  expectedSignal: string;
  fetchImpl?: typeof fetch;
  proof: WorldIdProof;
}): Promise<{ nullifier: string }> {
  const config = getWorldIdServerConfig();
  if (args.proof.environment !== config.environment) {
    throw new WorldIdVerificationError("World ID environment mismatch");
  }
  if (args.proof.action !== WORLD_ID_ACTION) {
    throw new WorldIdVerificationError("World ID action mismatch");
  }

  const first = args.proof.responses[0];
  if (!first) {
    throw new WorldIdVerificationError("World ID proof has no responses");
  }
  const expectedSignalHash = hashSignal(args.expectedSignal);
  if (first.signal_hash !== expectedSignalHash) {
    throw new WorldIdVerificationError("World ID signal mismatch");
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(`${config.verifyUrl}/${config.rpId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "zentity-world-id/1.0",
    },
    body: JSON.stringify(args.proof),
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

  return { nullifier: first.nullifier };
}
