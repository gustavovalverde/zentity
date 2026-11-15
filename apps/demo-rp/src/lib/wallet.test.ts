import { SDJwtInstance } from "@sd-jwt/core";
import { exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { sha256Hasher } from "./sd-jwt";
import {
  createPresentation,
  getDisclosedClaims,
  getPresentableKeys,
} from "./wallet";

let credential: string;

describe("VeriPass wallet", () => {
  beforeAll(async () => {
    const issuerKeys = await generateKeyPair("ES256");
    const holderKeys = await generateKeyPair("EdDSA", { extractable: true });
    const issuer = new SDJwtInstance({
      hasher: sha256Hasher,
      hashAlg: "sha-256",
      saltGenerator: () => crypto.randomUUID(),
      signAlg: "ES256",
      signer: async (data) =>
        Buffer.from(
          await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            issuerKeys.privateKey,
            new TextEncoder().encode(data)
          )
        ).toString("base64url"),
    });
    credential = await issuer.issue(
      {
        iss: "https://app.zentity.xyz",
        vct: "urn:credential:identity-verification:v1",
        cnf: { jwk: await exportJWK(holderKeys.publicKey) },
        verified: true,
        age_verification: true,
        nationality_group: "EU",
      },
      { _sd: ["verified", "age_verification", "nationality_group"] }
    );
  });

  it("lists only the selectively disclosable claims", async () => {
    await expect(getPresentableKeys(credential)).resolves.toEqual([
      "age_verification",
      "nationality_group",
      "verified",
    ]);
  });

  it("reports only the claims a presentation discloses", async () => {
    const presentation = await createPresentation(credential, [
      "age_verification",
    ]);

    await expect(getDisclosedClaims(presentation)).resolves.toEqual({
      age_verification: true,
    });
  });
});
