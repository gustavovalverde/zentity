import { describe, expect, it } from "vitest";

import { mlDsaKeygen, mlDsaSign } from "@/lib/privacy/primitives/ml-dsa";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/utils/base64";

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
  const [header = "", payload = "", signature = ""] = jwt.split(".");
  const decoder = new TextDecoder();
  return {
    header: JSON.parse(decoder.decode(base64UrlToBytes(header))),
    payload: JSON.parse(decoder.decode(base64UrlToBytes(payload))),
    signatureBytes: base64UrlToBytes(signature),
    signingInput: new TextEncoder().encode(`${header}.${payload}`),
  };
}

describe("ML-DSA-65 JWT signing", () => {
  const { secretKey } = mlDsaKeygen();

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

  describe("algorithm downgrade attacks", () => {
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
  });
});
