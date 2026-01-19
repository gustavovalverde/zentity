import { describe, expect, it, vi } from "vitest";

/** Matches a 32-character lowercase hex nonce */
const HEX_NONCE_PATTERN = /^[0-9a-f]{32}$/;

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock circuit artifacts
vi.mock(
  "@/noir-circuits/age_verification/artifacts/age_verification.json",
  () => ({
    default: {
      noir_version: "0.35.0",
      hash: 12_345,
      bytecode: "base64_bytecode_age",
    },
  })
);

vi.mock("@/noir-circuits/doc_validity/artifacts/doc_validity.json", () => ({
  default: {
    noir_version: "0.35.0",
    hash: 67_890,
    bytecode: "base64_bytecode_doc",
  },
}));

vi.mock(
  "@/noir-circuits/nationality_membership/artifacts/nationality_membership.json",
  () => ({
    default: {
      noir_version: "0.35.0",
      hash: 11_111,
      bytecode: "base64_bytecode_nat",
    },
  })
);

vi.mock("@/noir-circuits/face_match/artifacts/face_match.json", () => ({
  default: {
    noir_version: "0.35.0",
    hash: 22_222,
    bytecode: "base64_bytecode_face",
  },
}));

import { getBbJsVersion, getCircuitMetadata } from "../noir-verifier";
import {
  isProofType,
  normalizeChallengeNonce,
  PROOF_TYPE_SPECS,
} from "../proof-types";

describe("noir-verifier", () => {
  describe("getCircuitMetadata", () => {
    it("returns metadata for age_verification circuit", () => {
      const metadata = getCircuitMetadata("age_verification");

      expect(metadata.noirVersion).toBe("0.35.0");
      expect(metadata.circuitHash).toBe("12345");
    });

    it("returns metadata for doc_validity circuit", () => {
      const metadata = getCircuitMetadata("doc_validity");

      expect(metadata.noirVersion).toBe("0.35.0");
      expect(metadata.circuitHash).toBe("67890");
    });

    it("returns metadata for nationality_membership circuit", () => {
      const metadata = getCircuitMetadata("nationality_membership");

      expect(metadata.noirVersion).toBe("0.35.0");
      expect(metadata.circuitHash).toBe("11111");
    });

    it("returns metadata for face_match circuit", () => {
      const metadata = getCircuitMetadata("face_match");

      expect(metadata.noirVersion).toBe("0.35.0");
      expect(metadata.circuitHash).toBe("22222");
    });

    it("converts numeric hash to string", () => {
      const metadata = getCircuitMetadata("age_verification");

      expect(typeof metadata.circuitHash).toBe("string");
    });
  });

  describe("getBbJsVersion", () => {
    // Note: getBbJsVersion uses a module-level cache, so we can only test
    // its return value, not the caching behavior without resetting the module

    it("returns a version string or null", () => {
      const version = getBbJsVersion();

      // Version is either null or a semver-like string
      if (version !== null) {
        expect(typeof version).toBe("string");
        expect(version.length).toBeGreaterThan(0);
      }
    });

    it("returns consistent results on repeated calls (caching)", () => {
      const version1 = getBbJsVersion();
      const version2 = getBbJsVersion();

      expect(version1).toBe(version2);
    });
  });
});

describe("proof-types", () => {
  describe("PROOF_TYPE_SPECS", () => {
    it("defines specs for all proof types", () => {
      expect(PROOF_TYPE_SPECS.age_verification).toBeDefined();
      expect(PROOF_TYPE_SPECS.doc_validity).toBeDefined();
      expect(PROOF_TYPE_SPECS.nationality_membership).toBeDefined();
      expect(PROOF_TYPE_SPECS.face_match).toBeDefined();
      expect(PROOF_TYPE_SPECS.identity_binding).toBeDefined();
    });

    it("age_verification has correct spec", () => {
      const spec = PROOF_TYPE_SPECS.age_verification;
      expect(spec.minPublicInputs).toBe(5);
      expect(spec.nonceIndex).toBe(2);
      expect(spec.claimHashIndex).toBe(3);
      expect(spec.resultIndex).toBe(4);
    });

    it("doc_validity has correct spec", () => {
      const spec = PROOF_TYPE_SPECS.doc_validity;
      expect(spec.minPublicInputs).toBe(4);
      expect(spec.nonceIndex).toBe(1);
      expect(spec.claimHashIndex).toBe(2);
      expect(spec.resultIndex).toBe(3);
    });

    it("nationality_membership has correct spec", () => {
      const spec = PROOF_TYPE_SPECS.nationality_membership;
      expect(spec.minPublicInputs).toBe(4);
      expect(spec.nonceIndex).toBe(1);
      expect(spec.claimHashIndex).toBe(2);
      expect(spec.resultIndex).toBe(3);
    });

    it("face_match has correct spec", () => {
      const spec = PROOF_TYPE_SPECS.face_match;
      expect(spec.minPublicInputs).toBe(4);
      expect(spec.nonceIndex).toBe(1);
      expect(spec.claimHashIndex).toBe(2);
      expect(spec.resultIndex).toBe(3);
    });
  });

  describe("isProofType", () => {
    it("returns true for valid proof types", () => {
      expect(isProofType("age_verification")).toBe(true);
      expect(isProofType("doc_validity")).toBe(true);
      expect(isProofType("nationality_membership")).toBe(true);
      expect(isProofType("face_match")).toBe(true);
      expect(isProofType("identity_binding")).toBe(true);
    });

    it("returns false for invalid proof types", () => {
      expect(isProofType("invalid")).toBe(false);
      expect(isProofType("")).toBe(false);
      expect(isProofType(null)).toBe(false);
      expect(isProofType(undefined)).toBe(false);
      expect(isProofType(123)).toBe(false);
      expect(isProofType({})).toBe(false);
    });
  });

  describe("normalizeChallengeNonce", () => {
    it("normalizes 0x-prefixed 32-char hex string", () => {
      const nonce = "0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
      const result = normalizeChallengeNonce(nonce);

      expect(result).toHaveLength(32);
      expect(HEX_NONCE_PATTERN.test(result)).toBe(true);
    });

    it("normalizes 0x-prefixed hex", () => {
      const nonce = "0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
      const result = normalizeChallengeNonce(nonce);

      expect(result).toHaveLength(32);
    });

    it("pads short values to 32 chars", () => {
      const nonce = "0x1234";
      const result = normalizeChallengeNonce(nonce);

      expect(result).toHaveLength(32);
      expect(result.startsWith("00000000000000000000000000")).toBe(true);
      expect(result.endsWith("1234")).toBe(true);
    });

    it("masks to 128 bits for long field elements", () => {
      // 64-char hex (256-bit field element)
      const fieldElement =
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
      const result = normalizeChallengeNonce(fieldElement);

      // Result should be the low 128 bits
      expect(result).toHaveLength(32);
      expect(result).toBe("ffffffffffffffffffffffffffffffff");
    });

    it("returns deterministic results", () => {
      const nonce = "0xdeadbeef";
      const result1 = normalizeChallengeNonce(nonce);
      const result2 = normalizeChallengeNonce(nonce);

      expect(result1).toBe(result2);
    });
  });
});
