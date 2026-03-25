import { describe, expect, it } from "vitest";

import {
  ACR_DISPLAY_LABELS,
  CLAIM_DISPLAY_LABELS,
  ERROR_MESSAGES,
  formatAcrValue,
  GRANT_SOURCE_LABELS,
  SCOPE_GROUP_LABELS,
  TERMINOLOGY,
  VERIFICATION_LEVEL_LABELS,
} from "../copy-constants";

describe("copy-constants", () => {
  describe("TERMINOLOGY", () => {
    it("maps every internal term to a non-empty user-facing label", () => {
      for (const [key, value] of Object.entries(TERMINOLOGY)) {
        expect(value, `TERMINOLOGY.${key} is empty`).toBeTruthy();
        expect(typeof value).toBe("string");
      }
    });

    it("never contains raw internal terms in user-facing labels", () => {
      const forbidden = [
        "FHE",
        "PRF",
        "OPAQUE",
        "EIP-712",
        "BBS+",
        "sybil",
        "homomorphic",
      ];
      for (const [key, value] of Object.entries(TERMINOLOGY)) {
        for (const term of forbidden) {
          expect(
            value.includes(term),
            `TERMINOLOGY.${key} contains forbidden term "${term}": "${value}"`
          ).toBe(false);
        }
      }
    });

    it("snapshot matches expected mapping", () => {
      expect(TERMINOLOGY).toMatchInlineSnapshot(`
        {
          "binding": "linking",
          "bindingPast": "connected",
          "claims": "verified facts",
          "commitments": "verification data",
          "credential": "sign-in method",
          "enrollment": "setup",
          "fheKeys": "encryption keys",
          "fheKeysCapitalized": "Encryption Keys",
          "identityBound": "linked to your account",
          "identityBoundCapitalized": "Linked to Account",
          "liveness": "selfie check",
          "livenessBadge": "Selfie Check",
          "livenessCapitalized": "Selfie Check",
          "prfExtension": "passkey encryption features",
          "proofs": "verification records",
          "proofsCapitalized": "Verification Records",
          "sybilResistant": "unique person verified",
          "sybilResistantCapitalized": "Unique Person",
          "tier": "verification level",
          "verifiableCredentials": "Digital ID",
        }
      `);
    });
  });

  describe("VERIFICATION_LEVEL_LABELS", () => {
    it("covers all expected levels", () => {
      expect(VERIFICATION_LEVEL_LABELS).toHaveProperty("none");
      expect(VERIFICATION_LEVEL_LABELS).toHaveProperty("basic");
      expect(VERIFICATION_LEVEL_LABELS).toHaveProperty("full");
      expect(VERIFICATION_LEVEL_LABELS).toHaveProperty("chip");
    });

    it("all labels are non-empty strings", () => {
      for (const [level, label] of Object.entries(VERIFICATION_LEVEL_LABELS)) {
        expect(label, `level "${level}" has empty label`).toBeTruthy();
      }
    });
  });

  describe("SCOPE_GROUP_LABELS", () => {
    it("covers all expected group keys", () => {
      expect(SCOPE_GROUP_LABELS).toHaveProperty("account");
      expect(SCOPE_GROUP_LABELS).toHaveProperty("proofs");
      expect(SCOPE_GROUP_LABELS).toHaveProperty("identity");
    });

    it("all labels are non-empty strings", () => {
      for (const [key, label] of Object.entries(SCOPE_GROUP_LABELS)) {
        expect(label, `group "${key}" has empty label`).toBeTruthy();
      }
    });
  });

  describe("CLAIM_DISPLAY_LABELS", () => {
    it("covers all compliance check claim keys", () => {
      const expectedKeys = [
        "document_verified",
        "liveness_verified",
        "age_verified",
        "face_match_verified",
        "nationality_verified",
        "identity_bound",
        "sybil_resistant",
      ];
      for (const key of expectedKeys) {
        expect(
          CLAIM_DISPLAY_LABELS[key],
          `missing label for claim "${key}"`
        ).toBeDefined();
      }
    });

    it("never uses raw internal terms as labels", () => {
      const forbidden = ["Liveness", "Sybil", "Binding"];
      for (const [key, label] of Object.entries(CLAIM_DISPLAY_LABELS)) {
        for (const term of forbidden) {
          expect(
            label.includes(term),
            `CLAIM_DISPLAY_LABELS.${key} contains forbidden term "${term}": "${label}"`
          ).toBe(false);
        }
      }
    });
  });

  describe("GRANT_SOURCE_LABELS", () => {
    it("covers expected grant sources", () => {
      expect(GRANT_SOURCE_LABELS).toHaveProperty("requested");
      expect(GRANT_SOURCE_LABELS).toHaveProperty("default");
    });

    it("all labels are non-empty", () => {
      for (const [key, label] of Object.entries(GRANT_SOURCE_LABELS)) {
        expect(label, `source "${key}" has empty label`).toBeTruthy();
      }
    });
  });

  describe("formatAcrValue", () => {
    it("maps known URN values to plain labels", () => {
      expect(formatAcrValue("urn:zentity:assurance:tier3")).toBe(
        "Requires verified identity"
      );
      expect(formatAcrValue("urn:zentity:assurance:tier2")).toBe(
        "Requires basic verification"
      );
    });

    it("handles bare fragments without URN prefix", () => {
      expect(formatAcrValue("tier3")).toBe("Requires verified identity");
    });

    it("provides a reasonable fallback for unknown values", () => {
      const result = formatAcrValue("urn:zentity:assurance:unknown_level");
      expect(result).toContain("unknown_level");
      expect(result).not.toBe("urn:zentity:assurance:unknown_level");
    });

    it("covers all entries in ACR_DISPLAY_LABELS", () => {
      for (const [fragment, label] of Object.entries(ACR_DISPLAY_LABELS)) {
        expect(formatAcrValue(`urn:zentity:assurance:${fragment}`)).toBe(label);
      }
    });
  });

  describe("ERROR_MESSAGES", () => {
    it("all messages are non-empty strings", () => {
      for (const [key, msg] of Object.entries(ERROR_MESSAGES)) {
        expect(msg, `ERROR_MESSAGES.${key} is empty`).toBeTruthy();
        expect(typeof msg).toBe("string");
      }
    });

    it("never contains raw protocol terms", () => {
      const forbidden = ["PRF", "RFC 6979", "SDK", "FHE", "OPAQUE"];
      for (const [key, msg] of Object.entries(ERROR_MESSAGES)) {
        for (const term of forbidden) {
          expect(
            msg.includes(term),
            `ERROR_MESSAGES.${key} contains forbidden term "${term}"`
          ).toBe(false);
        }
      }
    });
  });
});
