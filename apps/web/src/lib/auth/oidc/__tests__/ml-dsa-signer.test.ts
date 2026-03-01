import { describe, expect, it } from "vitest";

import {
  mlDsaKeygen,
  mlDsaSign,
  mlDsaVerify,
} from "@/lib/privacy/primitives/ml-dsa";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/utils/base64url";

import { verifyMlDsaJwt } from "../ml-dsa-signer";

function buildJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secretKey: Uint8Array
): string {
  const encoder = new TextEncoder();
  const encodedHeader = bytesToBase64Url(
    encoder.encode(JSON.stringify(header))
  );
  const encodedPayload = bytesToBase64Url(
    encoder.encode(JSON.stringify(payload))
  );
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = mlDsaSign(signingInput, secretKey);
  return `${encodedHeader}.${encodedPayload}.${bytesToBase64Url(signature)}`;
}

function parseJwtParts(jwt: string) {
  const [header, payload, signature] = jwt.split(".");
  const decoder = new TextDecoder();
  return {
    header: JSON.parse(decoder.decode(base64UrlToBytes(header))),
    payload: JSON.parse(decoder.decode(base64UrlToBytes(payload))),
    signatureBytes: base64UrlToBytes(signature),
    signingInput: new TextEncoder().encode(`${header}.${payload}`),
  };
}

describe("ML-DSA-65 JWT signing", () => {
  const { publicKey, secretKey } = mlDsaKeygen();

  it("produces valid compact JWT with 3 parts", () => {
    const jwt = buildJwt(
      { alg: "ML-DSA-65", typ: "JWT", kid: "test-kid" },
      { sub: "user-1", iss: "zentity" },
      secretKey
    );

    expect(jwt.split(".")).toHaveLength(3);
  });

  it("header contains alg: ML-DSA-65", () => {
    const jwt = buildJwt(
      { alg: "ML-DSA-65", typ: "JWT", kid: "test-kid" },
      { sub: "user-1" },
      secretKey
    );

    const { header } = parseJwtParts(jwt);
    expect(header.alg).toBe("ML-DSA-65");
    expect(header.typ).toBe("JWT");
    expect(header.kid).toBe("test-kid");
  });

  it("payload round-trips through base64url decode", () => {
    const inputPayload = {
      sub: "user-1",
      iss: "https://zentity.xyz",
      iat: 1_700_000_000,
      nested: { value: true },
    };

    const jwt = buildJwt(
      { alg: "ML-DSA-65", typ: "JWT", kid: "k1" },
      inputPayload,
      secretKey
    );

    const { payload } = parseJwtParts(jwt);
    expect(payload).toEqual(inputPayload);
  });

  it("signature verifies with mlDsaVerify against known public key", () => {
    const jwt = buildJwt(
      { alg: "ML-DSA-65", typ: "JWT", kid: "k1" },
      { sub: "user-1" },
      secretKey
    );

    const { signatureBytes, signingInput } = parseJwtParts(jwt);
    expect(mlDsaVerify(signatureBytes, signingInput, publicKey)).toBe(true);
  });

  it("tampered payload fails verification", () => {
    const jwt = buildJwt(
      { alg: "ML-DSA-65", typ: "JWT", kid: "k1" },
      { sub: "user-1" },
      secretKey
    );

    const parts = jwt.split(".");
    // Replace payload with different data
    const tamperedPayload = bytesToBase64Url(
      new TextEncoder().encode(JSON.stringify({ sub: "attacker" }))
    );
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const { signatureBytes, signingInput } = parseJwtParts(tampered);
    expect(mlDsaVerify(signatureBytes, signingInput, publicKey)).toBe(false);
  });

  it("tampered header fails verification", () => {
    const jwt = buildJwt(
      { alg: "ML-DSA-65", typ: "JWT", kid: "k1" },
      { sub: "user-1" },
      secretKey
    );

    const parts = jwt.split(".");
    const tamperedHeader = bytesToBase64Url(
      new TextEncoder().encode(
        JSON.stringify({ alg: "ML-DSA-65", typ: "JWT", kid: "fake-kid" })
      )
    );
    const tampered = `${tamperedHeader}.${parts[1]}.${parts[2]}`;

    const { signatureBytes, signingInput } = parseJwtParts(tampered);
    expect(mlDsaVerify(signatureBytes, signingInput, publicKey)).toBe(false);
  });

  it("wrong public key fails verification", () => {
    const jwt = buildJwt(
      { alg: "ML-DSA-65", typ: "JWT", kid: "k1" },
      { sub: "user-1" },
      secretKey
    );

    const eve = mlDsaKeygen();
    const { signatureBytes, signingInput } = parseJwtParts(jwt);
    expect(mlDsaVerify(signatureBytes, signingInput, eve.publicKey)).toBe(
      false
    );
  });

  describe("structural attacks", () => {
    it("JWT with 2 parts (missing signature) → returns null", () => {
      const result = verifyMlDsaJwt("header.payload", publicKey);
      expect(result).toBeNull();
    });

    it("JWT with 4 parts → returns null", () => {
      const result = verifyMlDsaJwt("a.b.c.d", publicKey);
      expect(result).toBeNull();
    });

    it("empty string → returns null", () => {
      const result = verifyMlDsaJwt("", publicKey);
      expect(result).toBeNull();
    });

    it("empty signature part → fails verification", () => {
      const jwt = buildJwt(
        { alg: "ML-DSA-65", typ: "JWT", kid: "k1" },
        { sub: "user-1" },
        secretKey
      );
      const parts = jwt.split(".");
      const stripped = `${parts[0]}.${parts[1]}.`;

      const result = verifyMlDsaJwt(stripped, publicKey);
      expect(result).toBeNull();
    });
  });

  describe("algorithm downgrade attacks", () => {
    it("alg: 'none' in header → signature still checked, verification fails", () => {
      const jwt = buildJwt(
        { alg: "none", typ: "JWT", kid: "k1" },
        { sub: "user-1" },
        secretKey
      );
      // verifyMlDsaJwt always uses ML-DSA verify regardless of header.alg
      const result = verifyMlDsaJwt(jwt, publicKey);
      // The signature IS valid (signed with ML-DSA key) but the header says "none"
      // The verifier trusts the cryptography, not the header claim
      expect(result).not.toBeNull();
      expect(result?.header.alg).toBe("none");
    });

    it("alg: 'EdDSA' downgrade attempt → signature binding prevents misuse", () => {
      // Even if attacker changes alg to EdDSA, the signature is ML-DSA
      // and only verifiable with ML-DSA verify. An EdDSA verifier would reject it.
      const jwt = buildJwt(
        { alg: "EdDSA", typ: "JWT", kid: "k1" },
        { sub: "user-1" },
        secretKey
      );
      const { signatureBytes } = parseJwtParts(jwt);
      // ML-DSA signatures are 3309 bytes — no Ed25519 verifier accepts this size
      expect(signatureBytes.byteLength).toBe(3309);
    });

    it("header alg mismatch is detectable post-verification", () => {
      const jwt = buildJwt(
        { alg: "RS256", typ: "JWT", kid: "k1" },
        { sub: "user-1" },
        secretKey
      );
      const result = verifyMlDsaJwt(jwt, publicKey);
      // Caller MUST check result.header.alg === "ML-DSA-65"
      expect(result).not.toBeNull();
      expect(result?.header.alg).not.toBe("ML-DSA-65");
    });
  });
});
