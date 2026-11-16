import { AGENT_BOOTSTRAP_SCOPES } from "@zentity/sdk/agent-contract";
import { describe, expect, it } from "vitest";

import {
  describeScopes,
  HIDDEN_SCOPES,
  OAUTH_SCOPES,
  SCOPE_DESCRIPTIONS,
} from "../registry";

describe("disclosure registry — copy and visibility", () => {
  describe("scope descriptions", () => {
    it("every registered scope has a non-empty description", () => {
      for (const scope of OAUTH_SCOPES) {
        const desc = SCOPE_DESCRIPTIONS[scope];
        expect(desc, `scope "${scope}" has no description`).toBeDefined();
        expect(
          typeof desc === "string" && desc.length > 0,
          `scope "${scope}" has empty description`
        ).toBe(true);
      }
    });

    it("user-facing scope descriptions use plain language", () => {
      const technicalTerms = [
        "pseudonymous",
        "nullifier",
        "homomorphic",
        "OID4VCI",
        "NFC",
      ];

      for (const scope of OAUTH_SCOPES) {
        if (HIDDEN_SCOPES.has(scope)) {
          continue;
        }

        const desc = SCOPE_DESCRIPTIONS[scope] ?? "";
        for (const term of technicalTerms) {
          expect(
            desc.includes(term),
            `visible scope "${scope}" description contains "${term}": "${desc}"`
          ).toBe(false);
        }
      }
    });

    it("proof:sybil uses plain-language description", () => {
      expect(SCOPE_DESCRIPTIONS["proof:sybil"]).toBe(
        "A unique, anonymous ID for this app"
      );
    });

    it("proof:liveness uses selfie check terminology", () => {
      const desc = SCOPE_DESCRIPTIONS["proof:liveness"] ?? "";
      expect(desc.toLowerCase()).toContain("selfie");
      expect(desc.toLowerCase()).not.toContain("liveness");
    });

    it("proof:identity uses records terminology", () => {
      const desc = SCOPE_DESCRIPTIONS["proof:identity"] ?? "";
      expect(desc).toContain("records");
      expect(desc).not.toContain("proofs");
    });
  });

  describe("HIDDEN_SCOPES", () => {
    it("includes standard hidden scopes", () => {
      expect(HIDDEN_SCOPES.has("openid")).toBe(true);
      expect(HIDDEN_SCOPES.has("profile")).toBe(true);
    });

    it("includes the machine-facing operational scopes", () => {
      const operationalScopes = ["agent:introspect", "identity_verification"];

      for (const scope of operationalScopes) {
        expect(
          HIDDEN_SCOPES.has(scope),
          `operational scope "${scope}" should be hidden`
        ).toBe(true);
      }
    });

    it("does not hide user-facing scopes", () => {
      const mustBeVisible = [
        "compliance:read",
        "email",
        "offline_access",
        "proof:verification",
        "proof:age",
        "proof:document",
        "proof:liveness",
        "proof:nationality",
        "proof:compliance",
        "proof:chip",
        "proof:sybil",
        "proof:identity",
        "identity.name",
        "identity.dob",
        "identity.address",
        "identity.document",
        "identity.nationality",
      ];

      for (const scope of mustBeVisible) {
        expect(
          HIDDEN_SCOPES.has(scope),
          `user-facing scope "${scope}" should NOT be hidden`
        ).toBe(false);
      }
    });

    it("shows the agent bootstrap scopes, which a user grants at sign-in", () => {
      for (const scope of AGENT_BOOTSTRAP_SCOPES) {
        expect(HIDDEN_SCOPES.has(scope), scope).toBe(false);
      }
    });
  });

  describe("describeScopes", () => {
    it("gives the agent bootstrap scopes one plain-language line", () => {
      expect(
        describeScopes(["email", ...AGENT_BOOTSTRAP_SCOPES, "offline_access"])
      ).toEqual([
        { description: "Email address", scopes: ["email"] },
        {
          description: "Register and manage this agent on your behalf",
          scopes: [...AGENT_BOOTSTRAP_SCOPES],
        },
        {
          description: "Access when you're not using the app",
          scopes: ["offline_access"],
        },
      ]);
    });

    it("gives a single requested bootstrap scope the same line", () => {
      expect(describeScopes(["agent:session.revoke"])).toEqual([
        {
          description: "Register and manage this agent on your behalf",
          scopes: ["agent:session.revoke"],
        },
      ]);
    });
  });
});
