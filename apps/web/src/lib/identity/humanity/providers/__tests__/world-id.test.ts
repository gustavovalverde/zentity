import { hashSignal } from "@worldcoin/idkit/hashing";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_WORLD_ID_ENABLED: true,
    NEXT_PUBLIC_WORLD_ID_APP_ID: "app_test",
    WORLD_ID_RP_ID: "rp_test",
    WORLD_ID_RP_SIGNING_KEY:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    WORLD_ID_VERIFY_URL: "https://verify.example",
    WORLD_ID_ENVIRONMENT: "staging",
    WORLD_ID_RP_SIGNATURE_TTL_SECONDS: 300,
  },
}));

import { HumanityProofVerificationError } from "../../errors";
import {
  WORLD_ID_DEVICE_PROVIDER,
  WORLD_ID_DOCUMENT_PROVIDER,
  WORLD_ID_ORB_PROVIDER,
} from "../world-id";

const ACTION = "zentity-link-humanity";
const SIGNAL = "user-test-id";
const SIGNAL_HASH = hashSignal(SIGNAL);

interface AnyProof {
  action: string;
  environment: "production" | "staging";
  nonce: string;
  protocol_version: "3.0" | "4.0";
  responses: Record<string, unknown>[];
}

function makeV3Proof(overrides: Partial<AnyProof> = {}): unknown {
  return {
    protocol_version: "3.0",
    nonce: "nonce-test",
    action: ACTION,
    responses: [
      {
        identifier: "orb",
        proof: "0xproof",
        merkle_root: "0xroot",
        nullifier: "0xnullifier-orb",
        signal_hash: SIGNAL_HASH,
      },
    ],
    environment: "staging",
    ...overrides,
  };
}

function makeV4Proof(overrides: Partial<AnyProof> = {}): unknown {
  return {
    protocol_version: "4.0",
    nonce: "nonce-test",
    action: ACTION,
    responses: [
      {
        identifier: "proof_of_human",
        proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
        nullifier: "0xnullifier-v4",
        issuer_schema_id: 1,
        expires_at_min: 1_800_000_000,
        signal_hash: SIGNAL_HASH,
      },
    ],
    environment: "staging",
    ...overrides,
  };
}

function makeFetch(payload: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    Response.json(payload, { status })
  ) as unknown as typeof fetch;
}

describe("WORLD_ID_ORB_PROVIDER.verifyProof", () => {
  it("returns the v3 orb nullifier on successful verification", async () => {
    const fetchImpl = makeFetch({
      success: true,
      results: [{ identifier: "orb", success: true }],
      action: ACTION,
      environment: "staging",
    });

    await expect(
      WORLD_ID_ORB_PROVIDER.verifyProof({
        expectedSignal: SIGNAL,
        expectedNonce: "nonce-test",
        fetchImpl,
        proof: makeV3Proof(),
      })
    ).resolves.toMatchObject({
      providerSubject: "0xnullifier-orb",
      providerSubjectKind: "nullifier",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://verify.example/rp_test",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns the v4 nullifier when the proof_of_human level matches the orb provider", async () => {
    const fetchImpl = makeFetch({
      success: true,
      results: [{ identifier: "proof_of_human", success: true }],
    });

    await expect(
      WORLD_ID_ORB_PROVIDER.verifyProof({
        expectedSignal: SIGNAL,
        expectedNonce: "nonce-test",
        fetchImpl,
        proof: makeV4Proof(),
      })
    ).resolves.toMatchObject({ providerSubject: "0xnullifier-v4" });
  });

  it("rejects when the proof shape does not parse", async () => {
    await expect(
      WORLD_ID_ORB_PROVIDER.verifyProof({
        expectedSignal: SIGNAL,
        expectedNonce: "nonce-test",
        fetchImpl: makeFetch({}),
        proof: { not: "a proof" },
      })
    ).rejects.toBeInstanceOf(HumanityProofVerificationError);
  });

  it("rejects an unknown protocol version", async () => {
    await expect(
      WORLD_ID_ORB_PROVIDER.verifyProof({
        expectedSignal: SIGNAL,
        expectedNonce: "nonce-test",
        fetchImpl: makeFetch({}),
        proof: { ...(makeV3Proof() as object), protocol_version: "5.0" },
      })
    ).rejects.toBeInstanceOf(HumanityProofVerificationError);
  });

  it("rejects when the action does not match the configured ACTION", async () => {
    await expect(
      WORLD_ID_ORB_PROVIDER.verifyProof({
        expectedSignal: SIGNAL,
        expectedNonce: "nonce-test",
        fetchImpl: makeFetch({}),
        proof: makeV3Proof({ action: "other-action" }),
      })
    ).rejects.toThrow("World ID action mismatch");
  });

  it("rejects when the environment does not match the server config", async () => {
    await expect(
      WORLD_ID_ORB_PROVIDER.verifyProof({
        expectedSignal: SIGNAL,
        expectedNonce: "nonce-test",
        fetchImpl: makeFetch({}),
        proof: makeV3Proof({ environment: "production" }),
      })
    ).rejects.toThrow("World ID environment mismatch");
  });

  it("rejects when the proof nonce does not match the consumed challenge", async () => {
    await expect(
      WORLD_ID_ORB_PROVIDER.verifyProof({
        expectedSignal: SIGNAL,
        expectedNonce: "fresh-challenge-nonce",
        fetchImpl: makeFetch({}),
        proof: makeV3Proof({ nonce: "replayed-proof-nonce" }),
      })
    ).rejects.toThrow("World ID nonce mismatch");
  });

  it("rejects when the signal hash does not bind to the expected signal", async () => {
    await expect(
      WORLD_ID_ORB_PROVIDER.verifyProof({
        expectedSignal: "different-user-id",
        expectedNonce: "nonce-test",
        fetchImpl: makeFetch({}),
        proof: makeV3Proof(),
      })
    ).rejects.toThrow("World ID signal mismatch");
  });

  it("rejects when the verification level does not match the provider id", async () => {
    // Orb provider received a proof produced at the device level: must reject.
    await expect(
      WORLD_ID_ORB_PROVIDER.verifyProof({
        expectedSignal: SIGNAL,
        expectedNonce: "nonce-test",
        fetchImpl: makeFetch({}),
        proof: makeV3Proof({
          responses: [
            {
              identifier: "device",
              proof: "0xproof",
              merkle_root: "0xroot",
              nullifier: "0xnullifier-device",
              signal_hash: SIGNAL_HASH,
            },
          ],
        }),
      })
    ).rejects.toThrow("verification level mismatch");
  });

  it("propagates the upstream verifier HTTP status on rejection", async () => {
    const fetchImpl = makeFetch({ success: false }, 422);

    await WORLD_ID_ORB_PROVIDER.verifyProof({
      expectedSignal: SIGNAL,
      expectedNonce: "nonce-test",
      fetchImpl,
      proof: makeV3Proof(),
    }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(HumanityProofVerificationError);
      const verificationError = error as HumanityProofVerificationError;
      expect(verificationError.status).toBe(422);
    });
  });

  it("rejects when the upstream verifier returns a malformed body", async () => {
    await expect(
      WORLD_ID_ORB_PROVIDER.verifyProof({
        expectedSignal: SIGNAL,
        expectedNonce: "nonce-test",
        fetchImpl: makeFetch({ unexpected: "shape" }),
        proof: makeV3Proof(),
      })
    ).rejects.toThrow("Invalid World ID verification response");
  });
});

describe("WORLD_ID_DOCUMENT_PROVIDER.verifyProof", () => {
  it("rejects when an orb-level proof is presented", async () => {
    await expect(
      WORLD_ID_DOCUMENT_PROVIDER.verifyProof({
        expectedSignal: SIGNAL,
        expectedNonce: "nonce-test",
        fetchImpl: makeFetch({}),
        proof: makeV3Proof(),
      })
    ).rejects.toThrow("verification level mismatch");
  });
});

describe("WORLD_ID_DEVICE_PROVIDER.verifyProof", () => {
  it("accepts a device-level proof", async () => {
    const fetchImpl = makeFetch({
      success: true,
      results: [{ identifier: "device", success: true }],
    });

    await expect(
      WORLD_ID_DEVICE_PROVIDER.verifyProof({
        expectedSignal: SIGNAL,
        expectedNonce: "nonce-test",
        fetchImpl,
        proof: makeV3Proof({
          responses: [
            {
              identifier: "device",
              proof: "0xproof",
              merkle_root: "0xroot",
              nullifier: "0xnullifier-device",
              signal_hash: SIGNAL_HASH,
            },
          ],
        }),
      })
    ).resolves.toMatchObject({ providerSubject: "0xnullifier-device" });
  });
});

describe("provider registry metadata", () => {
  it("orb provider classifies as biometric evidence", () => {
    expect(WORLD_ID_ORB_PROVIDER.id).toBe("world_id_orb");
    expect(WORLD_ID_ORB_PROVIDER.evidenceStrength).toBe("biometric");
    expect(WORLD_ID_ORB_PROVIDER.subjectKind).toBe("nullifier");
  });

  it("document provider classifies as documentary evidence", () => {
    expect(WORLD_ID_DOCUMENT_PROVIDER.id).toBe("world_id_document");
    expect(WORLD_ID_DOCUMENT_PROVIDER.evidenceStrength).toBe("documentary");
  });

  it("device provider classifies as device evidence", () => {
    expect(WORLD_ID_DEVICE_PROVIDER.id).toBe("world_id_device");
    expect(WORLD_ID_DEVICE_PROVIDER.evidenceStrength).toBe("device");
  });
});
