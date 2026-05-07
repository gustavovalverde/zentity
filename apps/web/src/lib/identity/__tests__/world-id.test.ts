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

import {
  verifyWorldIdProof,
  type WorldIdProof,
  worldIdProofSchema,
} from "../world-id";

const ACTION = "zentity-link-human-signal";
const SIGNAL = "user-test-id";
const SIGNAL_HASH = hashSignal(SIGNAL);

function makeV3Proof(overrides: Partial<WorldIdProof> = {}): WorldIdProof {
  return {
    protocol_version: "3.0",
    nonce: "nonce-test",
    action: ACTION,
    responses: [
      {
        identifier: "orb",
        proof: "0xproof",
        merkle_root: "0xroot",
        nullifier: "0xnullifier-test",
        signal_hash: SIGNAL_HASH,
      },
    ],
    environment: "staging",
    ...overrides,
  } as WorldIdProof;
}

function makeV4Proof(overrides: Partial<WorldIdProof> = {}): WorldIdProof {
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
  } as WorldIdProof;
}

function makeFetch(payload: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    Response.json(payload, { status })
  ) as unknown as typeof fetch;
}

describe("World ID uniqueness verification", () => {
  it("accepts v3 and v4 uniqueness proofs", () => {
    expect(worldIdProofSchema.safeParse(makeV3Proof()).success).toBe(true);
    expect(worldIdProofSchema.safeParse(makeV4Proof()).success).toBe(true);
    expect(
      worldIdProofSchema.safeParse({
        ...makeV3Proof(),
        protocol_version: "5.0",
      }).success
    ).toBe(false);
  });

  it("returns the v3 nullifier on successful verification", async () => {
    const proof = makeV3Proof();
    const fetchImpl = makeFetch({
      success: true,
      results: [{ identifier: "orb", success: true }],
      action: ACTION,
      environment: "staging",
    });

    await expect(
      verifyWorldIdProof({ expectedSignal: SIGNAL, fetchImpl, proof })
    ).resolves.toEqual({ nullifier: "0xnullifier-test" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://verify.example/rp_test",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns the v4 nullifier on successful verification", async () => {
    const proof = makeV4Proof();
    const fetchImpl = makeFetch({
      success: true,
      results: [{ identifier: "proof_of_human", success: true }],
    });

    await expect(
      verifyWorldIdProof({ expectedSignal: SIGNAL, fetchImpl, proof })
    ).resolves.toEqual({ nullifier: "0xnullifier-v4" });
  });

  it("rejects when the action does not match", async () => {
    const proof = makeV3Proof({ action: "other-action" });
    await expect(
      verifyWorldIdProof({
        expectedSignal: SIGNAL,
        fetchImpl: makeFetch({}),
        proof,
      })
    ).rejects.toThrow("World ID action mismatch");
  });

  it("rejects when the environment does not match the configured one", async () => {
    const proof = makeV3Proof({ environment: "production" });
    await expect(
      verifyWorldIdProof({
        expectedSignal: SIGNAL,
        fetchImpl: makeFetch({}),
        proof,
      })
    ).rejects.toThrow("World ID environment mismatch");
  });

  it("rejects when the signal_hash does not match the expected user", async () => {
    const proof = makeV3Proof();
    await expect(
      verifyWorldIdProof({
        expectedSignal: "different-user",
        fetchImpl: makeFetch({}),
        proof,
      })
    ).rejects.toThrow("World ID signal mismatch");
  });

  it("rejects when the signal_hash is missing from the response", async () => {
    const proof = makeV3Proof({
      responses: [
        {
          identifier: "orb",
          proof: "0xproof",
          merkle_root: "0xroot",
          nullifier: "0xnullifier-test",
        },
      ],
    } as Partial<WorldIdProof>);
    await expect(
      verifyWorldIdProof({
        expectedSignal: SIGNAL,
        fetchImpl: makeFetch({}),
        proof,
      })
    ).rejects.toThrow("World ID signal mismatch");
  });

  it("rejects ambiguous verification responses", async () => {
    const proof = makeV3Proof();

    await expect(
      verifyWorldIdProof({
        expectedSignal: SIGNAL,
        fetchImpl: makeFetch({ success: true, results: [] }),
        proof,
      })
    ).rejects.toThrow("Invalid World ID verification response");

    await expect(
      verifyWorldIdProof({
        expectedSignal: SIGNAL,
        fetchImpl: makeFetch({
          success: true,
          results: [{ identifier: "orb", success: false }],
        }),
        proof,
      })
    ).rejects.toThrow("Invalid World ID verification response");
  });

  it("propagates upstream verification failures", async () => {
    const proof = makeV3Proof();
    await expect(
      verifyWorldIdProof({
        expectedSignal: SIGNAL,
        fetchImpl: makeFetch({ error: "bad" }, 400),
        proof,
      })
    ).rejects.toThrow("World ID verification failed");
  });
});
