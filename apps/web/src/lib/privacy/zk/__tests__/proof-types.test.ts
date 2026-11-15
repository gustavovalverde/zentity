import { describe, expect, it } from "vitest";

import ageCircuit from "@/noir-circuits/age_verification/artifacts/age_verification.json" with {
  type: "json",
};
import docValidityCircuit from "@/noir-circuits/doc_validity/artifacts/doc_validity.json" with {
  type: "json",
};
import faceMatchCircuit from "@/noir-circuits/face_match/artifacts/face_match.json" with {
  type: "json",
};
import identityBindingCircuit from "@/noir-circuits/identity_binding/artifacts/identity_binding.json" with {
  type: "json",
};
import nationalityCircuit from "@/noir-circuits/nationality_membership/artifacts/nationality_membership.json" with {
  type: "json",
};

import {
  normalizeChallengeNonce,
  PROOF_TYPE_SPECS,
  ProofType,
} from "../proof-types";

describe("ProofType", () => {
  it("lists the five circuits in the order that session completeness checks iterate", () => {
    expect(Object.values(ProofType)).toEqual([
      "age_verification",
      "doc_validity",
      "nationality_membership",
      "face_match",
      "identity_binding",
    ]);
  });
});

const CIRCUIT_ARTIFACTS = {
  [ProofType.AGE_VERIFICATION]: ageCircuit,
  [ProofType.DOC_VALIDITY]: docValidityCircuit,
  [ProofType.NATIONALITY_MEMBERSHIP]: nationalityCircuit,
  [ProofType.FACE_MATCH]: faceMatchCircuit,
  [ProofType.IDENTITY_BINDING]: identityBindingCircuit,
};

describe("PROOF_TYPE_SPECS", () => {
  for (const proofType of Object.values(ProofType)) {
    it(`${proofType} matches its compiled circuit ABI`, () => {
      const spec = PROOF_TYPE_SPECS[proofType];
      const { abi } = CIRCUIT_ARTIFACTS[proofType];
      const publicParams = abi.parameters
        .filter((parameter) => parameter.visibility === "public")
        .map((parameter) => parameter.name);
      const order = spec.publicInputOrder;
      const isBinding = proofType === ProofType.IDENTITY_BINDING;

      // Public inputs are the public parameters in order, then the public return value.
      expect(abi.return_type?.visibility).toBe("public");
      expect(order.slice(0, -1)).toEqual(publicParams);
      expect(spec.minPublicInputs).toBe(order.length);
      expect(spec.resultIndex).toBe(order.length - 1);
      expect(spec.nonceIndex).toBe(order.indexOf("nonce"));
      expect(spec.claimHashIndex).toBe(
        order.indexOf(isBinding ? "binding_commitment" : "claim_hash")
      );
      expect(spec.msgSenderIndex).toBe(
        isBinding ? order.indexOf("msg_sender_hash") : undefined
      );
      expect(spec.audienceIndex).toBe(
        isBinding ? order.indexOf("audience_hash") : undefined
      );
    });
  }
});

describe("normalizeChallengeNonce", () => {
  it("normalizes a 32-byte hex field element to a 16-byte nonce", () => {
    // 0x000...0001 -> 1
    const field =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    expect(normalizeChallengeNonce(field)).toBe(
      "00000000000000000000000000000001"
    );
  });

  it("preserves leading zeros from the low 128 bits", () => {
    const field =
      "0x00000000000000000000000000000000d71e131171721565373781d55af916b6";
    expect(normalizeChallengeNonce(field)).toBe(
      "d71e131171721565373781d55af916b6"
    );
  });

  it("normalizes decimal strings", () => {
    expect(normalizeChallengeNonce("1")).toBe(
      "00000000000000000000000000000001"
    );
  });
});
