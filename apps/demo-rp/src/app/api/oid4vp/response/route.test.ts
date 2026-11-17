// @vitest-environment node

import { deflateSync } from "node:zlib";

import { SdJwtInstance } from "@sd-jwt/core";
import { SdJwtVcInstance } from "@sd-jwt/sd-jwt-vc";
import {
  CompactEncrypt,
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVpSessionByState: vi.fn(),
  issuerKey: null as CryptoKey | null,
  updateVpSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://rp.example",
    NEXT_PUBLIC_ZENTITY_URL: "https://app.zentity.xyz",
    ZENTITY_URL: "http://zentity-internal:3000",
  },
}));
vi.mock("@/lib/oid4vp", () => ({
  getVpSessionByState: mocks.getVpSessionByState,
  updateVpSession: mocks.updateVpSession,
}));
vi.mock("@zentity/sdk/rp", () => ({
  createJwksTokenVerifier: () => ({
    verify: (token: string) => {
      if (!mocks.issuerKey) {
        throw new Error("issuer key not initialized");
      }
      return jwtVerify(token, mocks.issuerKey);
    },
  }),
}));

import { sha256Hasher } from "@/lib/sd-jwt";
import { employerVerifierScenario } from "@/scenarios/veripass/employer";
import { POST } from "./route";

const ISSUER = "https://app.zentity.xyz/api/auth";
const STATUS_LIST_URI = `${ISSUER}/oidc4vci/status-list`;
const CLIENT_ID = "x509_hash:leaf-thumbprint";
const NONCE = "session-nonce";
const VCT = "urn:credential:identity-verification:v1";
// Requires verified, verification_level, and document_verified.
const { dcqlQuery } = employerVerifierScenario;
const QUERY_ID = "identity_credential";
const ALL_CLAIMS = {
  verified: true,
  verification_level: "full",
  document_verified: true,
  liveness_verified: true,
};

let issuerPrivateKey: CryptoKey;
let holderPrivateKey: CryptoKey;
let holderJwk: Awaited<ReturnType<typeof exportJWK>>;

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function issueCredential(vct = VCT): Promise<string> {
  const issuer = new SdJwtVcInstance({
    hasher: sha256Hasher,
    hashAlg: "sha-256",
    saltGenerator: () => crypto.randomUUID(),
    signAlg: "ES256",
    signer: async (data) =>
      base64url(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            issuerPrivateKey,
            new TextEncoder().encode(data)
          )
        )
      ),
  });
  return issuer.issue(
    {
      iss: ISSUER,
      vct,
      iat: Math.floor(Date.now() / 1000),
      cnf: { jwk: holderJwk },
      status: { status_list: { idx: 0, uri: STATUS_LIST_URI } },
      ...ALL_CLAIMS,
    },
    { _sd: Object.keys(ALL_CLAIMS) as (keyof typeof ALL_CLAIMS)[] }
  );
}

/** The issuer's status list, in which every credential is valid. */
function statusListResponse(): Promise<Response> {
  return new SignJWT({
    iss: ISSUER,
    sub: STATUS_LIST_URI,
    status_list: { bits: 1, lst: base64url(deflateSync(Uint8Array.of(0))) },
  })
    .setProtectedHeader({ alg: "ES256", typ: "statuslist+jwt" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(issuerPrivateKey)
    .then(
      (jwt) =>
        new Response(jwt, {
          headers: { "content-type": "application/statuslist+jwt" },
        })
    );
}

/** The holder's presentation of `claimNames`, bound to this session. */
async function present(
  claimNames: string[],
  credential?: string
): Promise<string> {
  const holder = new SdJwtInstance({
    hasher: sha256Hasher,
    kbSignAlg: "EdDSA",
    kbSigner: async (data) =>
      base64url(
        new Uint8Array(
          await crypto.subtle.sign(
            "Ed25519",
            holderPrivateKey,
            new TextEncoder().encode(data)
          )
        )
      ),
  });
  return holder.present(
    credential ?? (await issueCredential()),
    Object.fromEntries(claimNames.map((name) => [name, true])),
    {
      kb: {
        payload: {
          aud: CLIENT_ID,
          iat: Math.floor(Date.now() / 1000),
          nonce: NONCE,
        },
      },
    }
  );
}

async function postResponse(vpToken: unknown) {
  const { privateKey, publicKey } = await generateKeyPair("ECDH-ES", {
    crv: "P-256",
    extractable: true,
  });
  const response = await new CompactEncrypt(
    new TextEncoder().encode(JSON.stringify({ vp_token: vpToken }))
  )
    .setProtectedHeader({ alg: "ECDH-ES", enc: "A256GCM" })
    .encrypt(publicKey);
  mocks.getVpSessionByState.mockResolvedValue({
    id: "session-1",
    clientId: CLIENT_ID,
    dcqlQuery: JSON.stringify(dcqlQuery),
    encryptionKey: JSON.stringify(await exportJWK(privateKey)),
    expiresAt: new Date(Date.now() + 60_000),
    nonce: NONCE,
    status: "pending",
  });
  return POST(
    new Request("https://rp.example/api/oid4vp/response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "session-state", response }),
    })
  );
}

const REQUIRED_CLAIMS = ["verified", "verification_level", "document_verified"];

describe("POST /api/oid4vp/response", () => {
  beforeAll(async () => {
    const issuerKeys = await generateKeyPair("ES256");
    const holderKeys = await generateKeyPair("EdDSA", { extractable: true });
    issuerPrivateKey = issuerKeys.privateKey;
    mocks.issuerKey = issuerKeys.publicKey;
    holderPrivateKey = holderKeys.privateKey;
    holderJwk = await exportJWK(holderKeys.publicKey);
  });

  beforeEach(() => {
    mocks.getVpSessionByState.mockReset();
    mocks.updateVpSession.mockReset();
    vi.stubGlobal("fetch", vi.fn(statusListResponse));
  });

  it.each([
    ["a bare presentation", (vp: string) => vp],
    [
      "a vp_token keyed by the query id",
      (vp: string) => ({ [QUERY_ID]: [vp] }),
    ],
  ])("verifies %s that answers the session's query", async (_label, shape) => {
    const res = await postResponse(shape(await present(REQUIRED_CLAIMS)));

    expect(res.status).toBe(200);
    expect(mocks.updateVpSession).toHaveBeenCalledWith("session-1", {
      status: "verified",
      result: JSON.stringify({
        document_verified: true,
        verification_level: "full",
        verified: true,
      }),
    });
  });

  it("accepts a claim beyond the session's query", async () => {
    const res = await postResponse(
      await present([...REQUIRED_CLAIMS, "liveness_verified"])
    );

    expect(res.status).toBe(200);
    expect(mocks.updateVpSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ status: "verified" })
    );
  });

  it.each([
    [
      "discloses fewer claims than the query names",
      () => present(["verified", "verification_level"]),
    ],
    [
      "carries another vct",
      async () =>
        present(
          REQUIRED_CLAIMS,
          await issueCredential("urn:credential:other:v1")
        ),
    ],
    [
      "is keyed by an unknown query id",
      async () => ({ other_credential: [await present(REQUIRED_CLAIMS)] }),
    ],
  ])("fails a presentation that %s", async (_label, vpToken) => {
    const res = await postResponse(await vpToken());

    expect(res.status).toBe(400);
    expect(mocks.updateVpSession).toHaveBeenCalledWith("session-1", {
      status: "failed",
      result: JSON.stringify({ error: "Verification failed" }),
    });
    expect(mocks.updateVpSession).not.toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ status: "verified" })
    );
  });
});
