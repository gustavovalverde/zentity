import { SDJwtInstance } from "@sd-jwt/core";
import {
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  type JWK,
  jwtVerify,
  SignJWT,
} from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

const issuerKey = vi.hoisted(() => ({ current: null as CryptoKey | null }));

vi.mock("@zentity/sdk/rp", () => ({
  createJwksTokenVerifier: () => ({
    verify: (token: string) => {
      if (!issuerKey.current) {
        throw new Error("issuer key not initialized");
      }
      return jwtVerify(token, issuerKey.current);
    },
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: { ZENTITY_URL: "http://zentity-internal:3000" },
}));

import { sha256Hasher } from "./sd-jwt";
import { verifyVpToken } from "./verify";

const ISSUER = "https://app.zentity.xyz";
const VCT = "urn:credential:identity-verification:v1";
const NONCE = "session-nonce";
const AUDIENCE = "x509_hash:verifier-leaf-thumbprint";

interface KeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

let issuerKeys: KeyPair;
let holderKeys: KeyPair;
let holderJwk: JWK;
let credential: string;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function base64url(input: string | Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

async function sha256Base64url(input: string): Promise<string> {
  return base64url(await sha256Hasher(input, "sha-256"));
}

function issueCredential(cnfJwk: JWK): Promise<string> {
  const issuer = new SDJwtInstance({
    hasher: sha256Hasher,
    hashAlg: "sha-256",
    saltGenerator: () => crypto.randomUUID(),
    signAlg: "ES256",
    signer: async (data) =>
      base64url(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            issuerKeys.privateKey,
            new TextEncoder().encode(data)
          )
        )
      ),
  });
  return issuer.issue(
    {
      iss: ISSUER,
      vct: VCT,
      iat: nowSeconds(),
      cnf: { jwk: cnfJwk },
      verified: true,
      age_verification: false,
      nationality_group: "EU",
    },
    { _sd: ["verified", "age_verification", "nationality_group"] }
  );
}

/** Holder-side presentation without a KB-JWT, as the wallet builds it. */
function presentDisclosures(
  claimNames: string[],
  sdJwt = credential
): Promise<string> {
  const holder = new SDJwtInstance({ hasher: sha256Hasher });
  return holder.present(
    sdJwt,
    Object.fromEntries(claimNames.map((name) => [name, true]))
  );
}

/** Appends a KB-JWT over `presentation` (which ends with `~`). */
async function bind(
  presentation: string,
  overrides: {
    aud?: string;
    iat?: number;
    key?: CryptoKey;
    nonce?: string;
    sdHashInput?: string;
    typ?: string;
  } = {}
): Promise<string> {
  const kbJwt = await new SignJWT({
    aud: overrides.aud ?? AUDIENCE,
    iat: overrides.iat ?? nowSeconds(),
    nonce: overrides.nonce ?? NONCE,
    sd_hash: await sha256Base64url(overrides.sdHashInput ?? presentation),
  })
    .setProtectedHeader({ alg: "EdDSA", typ: overrides.typ ?? "kb+jwt" })
    .sign(overrides.key ?? holderKeys.privateKey);
  return `${presentation}${kbJwt}`;
}

describe("verifyVpToken", () => {
  beforeAll(async () => {
    issuerKeys = await generateKeyPair("ES256");
    holderKeys = await generateKeyPair("EdDSA", { extractable: true });
    holderJwk = { ...(await exportJWK(holderKeys.publicKey)), alg: "EdDSA" };
    issuerKey.current = issuerKeys.publicKey;
    credential = await issueCredential(holderJwk);
  });

  it("returns only the claims the holder disclosed", async () => {
    const vpToken = await bind(
      await presentDisclosures(["verified", "nationality_group"])
    );

    await expect(verifyVpToken(vpToken, NONCE, AUDIENCE)).resolves.toEqual({
      verified: true,
      nationality_group: "EU",
    });
  });

  it.each([
    ["names no alg", undefined],
    ["names Ed25519", "Ed25519"],
  ])("accepts a holder JWK that %s", async (_label, alg) => {
    const { alg: _omitted, ...bareJwk } = holderJwk;
    const sdJwt = await issueCredential(alg ? { ...bareJwk, alg } : bareJwk);
    const vpToken = await bind(await presentDisclosures(["verified"], sdJwt));

    await expect(verifyVpToken(vpToken, NONCE, AUDIENCE)).resolves.toEqual({
      verified: true,
    });
  });

  it("rejects a disclosure the issuer did not sign", async () => {
    const forged = base64url('["forged-salt","age_verification",true]');
    const vpToken = await bind(
      `${await presentDisclosures(["verified"])}${forged}~`
    );

    await expect(verifyVpToken(vpToken, NONCE, AUDIENCE)).resolves.toBeNull();
  });

  it("rejects disclosures the KB-JWT sd_hash does not cover", async () => {
    const boundPresentation = await presentDisclosures(["verified"]);
    const widened = await presentDisclosures(["verified", "nationality_group"]);
    const vpToken = await bind(widened, { sdHashInput: boundPresentation });

    await expect(verifyVpToken(vpToken, NONCE, AUDIENCE)).resolves.toBeNull();
  });

  it("rejects disclosures with duplicate JSON member names", async () => {
    const disclosure = base64url(
      '["salt","address",{"country":"US","country":"CA"}]'
    );
    const issuerJwt = await new SignJWT({
      iss: ISSUER,
      vct: VCT,
      cnf: { jwk: holderJwk },
      _sd: [await sha256Base64url(disclosure)],
      _sd_alg: "sha-256",
    })
      .setProtectedHeader({ alg: "ES256", typ: "dc+sd-jwt" })
      .setIssuedAt()
      .sign(issuerKeys.privateKey);
    const vpToken = await bind(`${issuerJwt}~${disclosure}~`);

    await expect(verifyVpToken(vpToken, NONCE, AUDIENCE)).resolves.toBeNull();
  });

  it("rejects the same disclosure presented twice", async () => {
    const presentation = await presentDisclosures(["verified"]);
    const [issuerJwt, disclosure] = presentation.split("~");
    const vpToken = await bind(`${issuerJwt}~${disclosure}~${disclosure}~`);

    await expect(verifyVpToken(vpToken, NONCE, AUDIENCE)).resolves.toBeNull();
  });

  it("rejects a presentation without a KB-JWT", async () => {
    const vpToken = await presentDisclosures(["verified"]);

    await expect(verifyVpToken(vpToken, NONCE, AUDIENCE)).resolves.toBeNull();
  });

  it("never skips holder binding when the expected nonce is empty", async () => {
    const vpToken = await bind(await presentDisclosures(["verified"]), {
      nonce: "",
    });

    await expect(verifyVpToken(vpToken, "", AUDIENCE)).resolves.toBeNull();
  });

  it.each([
    ["another nonce", { nonce: "other-nonce" }],
    ["another audience", { aud: "https://other-verifier.example" }],
    ["an iat older than five minutes", { iat: nowSeconds() - 301 }],
    ["a typ other than kb+jwt", { typ: "JWT" }],
  ])("rejects a KB-JWT with %s", async (_label, overrides) => {
    const vpToken = await bind(
      await presentDisclosures(["verified"]),
      overrides
    );

    await expect(verifyVpToken(vpToken, NONCE, AUDIENCE)).resolves.toBeNull();
  });

  it("rejects a KB-JWT not signed by the credential's holder key", async () => {
    const otherHolder = await generateKeyPair("EdDSA");
    const vpToken = await bind(await presentDisclosures(["verified"]), {
      key: otherHolder.privateKey,
    });

    await expect(verifyVpToken(vpToken, NONCE, AUDIENCE)).resolves.toBeNull();
  });

  it("rejects an issuer JWT the Zentity JWKS does not verify", async () => {
    const original = issuerKey.current;
    issuerKey.current = (await generateKeyPair("ES256")).publicKey;
    try {
      const vpToken = await bind(await presentDisclosures(["verified"]));

      await expect(verifyVpToken(vpToken, NONCE, AUDIENCE)).resolves.toBeNull();
    } finally {
      issuerKey.current = original;
    }
  });
});
