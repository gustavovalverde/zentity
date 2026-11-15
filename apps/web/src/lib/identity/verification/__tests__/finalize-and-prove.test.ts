import { afterEach, describe, expect, it, vi } from "vitest";

const prove = vi.hoisted(() => {
  const proofResult = {
    generationTimeMs: 1,
    proof: "proof",
    publicSignals: [] as string[],
  };
  return {
    createProofSession: vi.fn(() =>
      Promise.resolve({ proofSessionId: "session-1" })
    ),
    generateAgeProof: vi.fn(() => Promise.resolve(proofResult)),
    generateDocValidityProof: vi.fn(() => Promise.resolve(proofResult)),
    generateFaceMatchProof: vi.fn(() => Promise.resolve(proofResult)),
    generateIdentityBindingProof: vi.fn(() => Promise.resolve(proofResult)),
    generateNationalityProof: vi.fn(() => Promise.resolve(proofResult)),
    getProofChallenge: vi.fn(() => Promise.resolve({ nonce: "nonce" })),
    getSignedClaims: vi.fn(() =>
      Promise.resolve({
        ocr: {
          documentHashField: "0x01",
          data: {
            claimHashes: {
              age: "0x02",
              docValidity: "0x03",
              nationality: "0x04",
            },
          },
        },
        faceMatch: {
          documentHashField: "0x01",
          data: {
            confidenceFixed: 9000,
            thresholdFixed: 8000,
            claimHash: "0x05",
          },
        },
      })
    ),
    storeProof: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("@/lib/privacy/zk/prove", () => prove);
vi.mock("@/lib/privacy/zk/binding-secret", () => ({
  prepareBindingProofInputs: () => ({
    bindingSecretField: "0x06",
    userIdHashField: "0x07",
    documentHashField: "0x08",
  }),
}));
vi.mock("@/lib/privacy/credentials/cache", () => ({
  clearCachedBindingMaterial: vi.fn(),
}));
vi.mock("@/lib/privacy/zk/noir/worker-manager", () => ({}));

import { generateAllProofs } from "../finalize-and-prove";

const originalTz = process.env.TZ;

afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

describe("generateAllProofs", () => {
  it("passes the UTC date to the doc_validity proof regardless of the browser time zone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-12T23:30:00Z"));
    // Auckland is already on the 13th at this instant.
    process.env.TZ = "Pacific/Auckland";

    await generateAllProofs({
      verificationId: "verification-1",
      profilePayload: null,
      extractedDOB: "1990-01-01",
      extractedExpirationDate: "2030-01-01",
      extractedNationalityCode: "DEU",
      bindingContext: {
        userId: "user-1",
        bindingResult: {},
      } as Parameters<typeof generateAllProofs>[0]["bindingContext"],
    });

    expect(prove.generateDocValidityProof).toHaveBeenCalledWith(
      20_300_101,
      20_251_212,
      expect.any(Object)
    );
  });
});
