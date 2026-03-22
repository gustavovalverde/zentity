/**
 * RP Contract Tests
 *
 * Validates that Zentity's OIDC surface area matches what demo-RPs expect.
 * If any of these tests fail, the demo-rp OAuth integration will break.
 *
 * The demo-rp (apps/demo-rp) relies on:
 * 1. JWKS at /api/auth/oauth2/jwks serving RS256/ES256/EdDSA/ML-DSA-65 keys
 * 2. jose's jwtVerify + createRemoteJWKSet to verify id_tokens
 * 3. Specific proof:* and identity.* scopes mapping to known claim keys
 * 4. RS256 as the default id_token signing algorithm (OIDC spec requirement)
 * 5. Proof claims available in BOTH id_token and userinfo
 */

import { createLocalJWKSet, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/jwks";

import { ID_TOKEN_SIGNING_ALGS } from "../../well-known-utils";
import { PROOF_DISCLOSURE_KEYS } from "../claims";
import { IDENTITY_SCOPE_CLAIMS, IDENTITY_SCOPES } from "../identity-scopes";
import {
  extractProofScopes,
  filterProofClaimsByScopes,
  PROOF_SCOPES,
} from "../proof-scopes";

let signJwt: typeof import("../jwt-signer").signJwt;

/**
 * Mirror of demo-rp's PROVIDER_SCOPES from apps/demo-rp/src/lib/auth.ts.
 * If the demo-rp changes its scopes, update this constant and the tests
 * will catch any misalignment with Zentity's scope definitions.
 */
const DEMO_RP_PROVIDER_SCOPES: Record<string, string[]> = {
  bank: ["openid", "email", "proof:verification"],
  exchange: ["openid", "email", "proof:verification"],
  wine: ["openid", "email", "proof:age"],
  aid: ["openid", "email", "proof:verification"],
  veripass: ["openid", "email", "proof:verification"],
};

/**
 * Mirror of demo-rp's step-up scopes from apps/demo-rp/src/lib/scenarios.ts.
 */
const DEMO_RP_STEP_UP_SCOPES: Record<string, string[]> = {
  bank: ["identity.name"],
  exchange: ["identity.nationality"],
  wine: ["identity.name", "identity.address"],
  aid: ["identity.name", "identity.nationality"],
  veripass: [],
};

/**
 * Mirror of demo-rp's expected step-up claim keys from apps/demo-rp/src/lib/scenarios.ts.
 */
const DEMO_RP_STEP_UP_CLAIM_KEYS: Record<string, string[]> = {
  bank: ["given_name", "family_name"],
  exchange: ["nationality"],
  wine: ["given_name", "address"],
  aid: ["given_name", "nationality"],
  veripass: [],
};

describe("RP contract — scope alignment", () => {
  it("all demo-rp proof scopes are recognized by Zentity", () => {
    const allRpScopes = Object.values(DEMO_RP_PROVIDER_SCOPES).flat();
    const rpProofScopes = allRpScopes.filter((s) => s.startsWith("proof:"));
    const uniqueProofScopes = [...new Set(rpProofScopes)];

    for (const scope of uniqueProofScopes) {
      expect(
        [...PROOF_SCOPES, "proof:identity"].includes(scope as never),
        `demo-rp uses scope "${scope}" which is not in Zentity's PROOF_SCOPES`
      ).toBe(true);
    }
  });

  it("all demo-rp identity step-up scopes are recognized by Zentity", () => {
    const allStepUpScopes = Object.values(DEMO_RP_STEP_UP_SCOPES).flat();
    const uniqueScopes = [...new Set(allStepUpScopes)];

    for (const scope of uniqueScopes) {
      expect(
        IDENTITY_SCOPES.includes(scope as never),
        `demo-rp uses step-up scope "${scope}" which is not in Zentity's IDENTITY_SCOPES`
      ).toBe(true);
    }
  });

  it("demo-rp step-up claim keys match Zentity's identity scope → claim mapping", () => {
    for (const [scenario, stepUpScopes] of Object.entries(
      DEMO_RP_STEP_UP_SCOPES
    )) {
      const expectedClaimKeys = DEMO_RP_STEP_UP_CLAIM_KEYS[scenario] ?? [];
      const zentityClaimKeys = stepUpScopes.flatMap(
        (scope) =>
          IDENTITY_SCOPE_CLAIMS[scope as keyof typeof IDENTITY_SCOPE_CLAIMS] ??
          []
      );

      for (const key of expectedClaimKeys) {
        expect(
          zentityClaimKeys.includes(key as never),
          `${scenario}: expects claim "${key}" from scopes [${stepUpScopes}], ` +
            `but Zentity maps those to [${zentityClaimKeys}]`
        ).toBe(true);
      }
    }
  });

  it("proof:verification scope produces the claims demo-rp scenarios expect", () => {
    const mockProofClaims: Record<string, unknown> = {};
    for (const key of PROOF_DISCLOSURE_KEYS) {
      mockProofClaims[key] = true;
    }

    const filtered = filterProofClaimsByScopes(mockProofClaims, [
      "proof:verification",
    ]);

    expect(filtered).toHaveProperty("verification_level");
    expect(filtered).toHaveProperty("verified");
    expect(filtered).toHaveProperty("identity_bound");
    expect(filtered).toHaveProperty("sybil_resistant");
  });

  it("proof:age scope produces age_verification (wine scenario)", () => {
    const mockProofClaims: Record<string, unknown> = {};
    for (const key of PROOF_DISCLOSURE_KEYS) {
      mockProofClaims[key] = true;
    }

    const filtered = filterProofClaimsByScopes(mockProofClaims, ["proof:age"]);

    expect(filtered).toHaveProperty("age_verification");
    expect(Object.keys(filtered)).toHaveLength(1);
  });

  it("extractProofScopes filters correctly for all demo-rp scope sets", () => {
    for (const [scenario, scopes] of Object.entries(DEMO_RP_PROVIDER_SCOPES)) {
      const proofScopes = extractProofScopes(scopes);
      const expectedProof = scopes.filter((s) => s.startsWith("proof:"));
      expect(proofScopes, `${scenario}: extractProofScopes mismatch`).toEqual(
        expectedProof
      );
    }
  });
});

describe("RP contract — id_token signing", () => {
  /**
   * Build a JWKS from the DB, exactly as /api/auth/oauth2/jwks does.
   */
  async function buildJwksFromDb(): Promise<Record<string, unknown>[]> {
    const allKeys = await db.select().from(jwks);
    return allKeys.map((row) => ({
      ...(JSON.parse(row.publicKey) as Record<string, unknown>),
      kid: row.id,
      ...(row.alg ? { alg: row.alg } : {}),
      ...(row.crv ? { crv: row.crv } : {}),
    }));
  }

  beforeAll(async () => {
    // Dynamic import — signJwt will lazy-create keys in the DB if absent
    const mod = await import("../jwt-signer");
    signJwt = mod.signJwt;

    // Warm up: trigger lazy key creation for both RS256 and EdDSA
    await signJwt({ aud: "warmup", sub: "warmup" }); // id_token → RS256
    await signJwt({ scope: "openid", sub: "warmup" }); // access token → EdDSA
  });

  it("default id_token is RS256 — verifiable via JWKS like demo-rp does", async () => {
    const token = await signJwt({
      aud: "zentity-demo-bank",
      sub: "user-123",
      iss: "http://localhost:3000/api/auth",
    });

    // Mimics demo-rp's: createRemoteJWKSet(jwks) → jwtVerify
    const jwksKeys = await buildJwksFromDb();
    const localJwks = createLocalJWKSet({ keys: jwksKeys });
    const { payload, protectedHeader } = await jwtVerify(token, localJwks);

    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.sub).toBe("user-123");
    expect(payload.aud).toBe("zentity-demo-bank");
  });

  it("access tokens stay EdDSA — verifiable via same JWKS", async () => {
    const token = await signJwt({
      scope: "openid email proof:verification",
      azp: "zentity-demo-bank",
      sub: "user-123",
    });

    const jwksKeys = await buildJwksFromDb();
    const localJwks = createLocalJWKSet({ keys: jwksKeys });
    const { protectedHeader } = await jwtVerify(token, localJwks);

    expect(protectedHeader.alg).toBe("EdDSA");
  });

  it("JWKS serves keys in the format jose expects (kid + alg present)", async () => {
    const jwksKeys = await buildJwksFromDb();

    const rsaKey = jwksKeys.find((k) => k.alg === "RS256");
    expect(rsaKey).toBeDefined();
    expect(rsaKey?.kty).toBe("RSA");
    expect(rsaKey?.kid).toBeDefined();

    const edDsaKey = jwksKeys.find((k) => k.alg === "EdDSA");
    expect(edDsaKey).toBeDefined();
    expect(edDsaKey?.kty).toBe("OKP");
    expect(edDsaKey?.crv).toBe("Ed25519");
    expect(edDsaKey?.kid).toBeDefined();
  });
});

describe("RP contract — discovery metadata shape", () => {
  it("advertised algorithms include RS256 (OIDC mandatory) plus Zentity extras", () => {
    // OIDC Discovery 1.0 §3: RS256 MUST be included
    expect(ID_TOKEN_SIGNING_ALGS).toContain("RS256");
    // HAIP §7: ES256 MUST be supported
    expect(ID_TOKEN_SIGNING_ALGS).toContain("ES256");
    // Zentity's advanced algorithms
    expect(ID_TOKEN_SIGNING_ALGS).toContain("EdDSA");
    expect(ID_TOKEN_SIGNING_ALGS).toContain("ML-DSA-65");
  });

  it("OIDC Client Registration default alg (RS256) matches Zentity's id_token default", async () => {
    // OIDC Client Registration §2: default id_token_signed_response_alg is RS256
    // When demo-rp registers a client without specifying an alg, Zentity should
    // sign id_tokens with RS256
    const token = await signJwt({
      aud: "unregistered-client",
      sub: "user-1",
    });

    const header = JSON.parse(
      Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf-8")
    );
    expect(header.alg).toBe("RS256");
  });
});
