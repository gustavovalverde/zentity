import { randomUUID } from "node:crypto";
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
} from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const BASE64URL_PLUS = /\+/g;
const BASE64URL_SLASH = /\//g;
const BASE64URL_PAD = /=+$/;

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
    port: 3200,
    transport: "http",
    allowedOrigins: ["http://localhost:*", "http://127.0.0.1:*"],
  },
}));

import {
  isAuthError,
  resetJwks,
  validateToken,
} from "../../src/transports/token-auth.js";

// Test key pair for signing tokens
let signingPrivateKey: CryptoKey;
let signingJwk: JsonWebKey;

// DPoP key pair
let dpopPrivateJwk: JsonWebKey;
let dpopPublicJwk: JsonWebKey;
let dpopJkt: string;

const METHOD = "POST";
const URL = "http://localhost:3200/mcp";

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    extractable: true,
  });
  signingPrivateKey = privateKey as unknown as CryptoKey;
  signingJwk = await exportJWK(publicKey);
  signingJwk.kid = "test-kid";

  const dpopPair = await generateKeyPair("ES256", { extractable: true });
  dpopPrivateJwk = await exportJWK(dpopPair.privateKey);
  dpopPublicJwk = await exportJWK(dpopPair.publicKey);
  dpopJkt = await calculateJwkThumbprint(dpopPublicJwk, "sha256");
});

async function signToken(
  claims: Record<string, unknown> = {},
  opts: { audience?: string; expiresIn?: string; issuer?: string } = {}
): Promise<string> {
  const key = await importJWK(
    { ...signingJwk, ...(await exportJWK(signingPrivateKey)) },
    "EdDSA"
  );
  return new SignJWT({ scope: "openid", ...claims })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-kid" })
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "5m")
    .setIssuer(opts.issuer ?? "http://localhost:3000/api/auth")
    .setAudience(opts.audience ?? "http://localhost:3200")
    .setSubject("user-123")
    .sign(key);
}

async function createDpopProof(
  accessToken: string,
  opts: {
    method?: string;
    url?: string;
    iat?: number;
    useWrongKey?: boolean;
  } = {}
): Promise<string> {
  let keyToUse = dpopPrivateJwk;
  let pubKeyToEmbed = dpopPublicJwk;

  if (opts.useWrongKey) {
    // Generate a consistent wrong key pair — signed correctly but different from cnf.jkt
    const wrongPair = await generateKeyPair("ES256", { extractable: true });
    keyToUse = await exportJWK(wrongPair.privateKey);
    pubKeyToEmbed = await exportJWK(wrongPair.publicKey);
  }

  const key = await importJWK(keyToUse, "ES256");
  const encoder = new TextEncoder();
  const hash = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(accessToken)
  );
  const ath = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(BASE64URL_PLUS, "-")
    .replace(BASE64URL_SLASH, "_")
    .replace(BASE64URL_PAD, "");

  return new SignJWT({
    htm: (opts.method ?? METHOD).toUpperCase(),
    htu: opts.url ?? URL,
    jti: randomUUID(),
    iat: opts.iat ?? Math.floor(Date.now() / 1000),
    ath,
  })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: pubKeyToEmbed })
    .sign(key);
}

// Mock JWKS by intercepting jose's createRemoteJWKSet
// We reset JWKS before each test and mock the fetch to return our test key
afterEach(() => {
  resetJwks();
  vi.restoreAllMocks();
});

function mockJwks(): void {
  // Mock global fetch to return our test JWKS
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ keys: [signingJwk] }))
  );
}

describe("validateToken", () => {
  it("returns error when Authorization header is missing", async () => {
    const result = await validateToken(undefined, undefined, METHOD, URL);
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(401);
      expect(result.body.error).toBe("invalid_request");
      expect(result.wwwAuthenticate).toContain("resource_metadata");
    }
  });

  it("returns error for malformed Authorization header", async () => {
    const result = await validateToken(
      "InvalidScheme token",
      undefined,
      METHOD,
      URL
    );
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(401);
      expect(result.body.error).toBe("invalid_request");
    }
  });

  it("accepts a valid Bearer token", async () => {
    mockJwks();
    const token = await signToken();
    const result = await validateToken(
      `Bearer ${token}`,
      undefined,
      METHOD,
      URL
    );
    expect(isAuthError(result)).toBe(false);
    if (!isAuthError(result)) {
      expect(result.scheme).toBe("Bearer");
      expect(result.payload.sub).toBe("user-123");
    }
  });

  it("rejects a token with insufficient scopes", async () => {
    mockJwks();
    const token = await signToken({ scope: "email" }); // missing "openid"
    const result = await validateToken(
      `Bearer ${token}`,
      undefined,
      METHOD,
      URL
    );
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(403);
      expect(result.body.error).toBe("insufficient_scope");
    }
  });

  it("rejects an expired token", async () => {
    mockJwks();
    const token = await signToken({}, { expiresIn: "-1s" });
    const result = await validateToken(
      `Bearer ${token}`,
      undefined,
      METHOD,
      URL
    );
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(401);
      expect(result.body.error).toBe("invalid_token");
      expect(result.body.error_description).toContain("expired");
    }
  });

  it("rejects a token from the wrong issuer", async () => {
    mockJwks();
    const token = await signToken({}, { issuer: "https://evil.com" });
    const result = await validateToken(
      `Bearer ${token}`,
      undefined,
      METHOD,
      URL
    );
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(401);
      expect(result.body.error).toBe("invalid_token");
    }
  });

  it("rejects Bearer scheme for sender-constrained token (cnf.jkt)", async () => {
    mockJwks();
    const token = await signToken({ cnf: { jkt: dpopJkt } });
    const result = await validateToken(
      `Bearer ${token}`,
      undefined,
      METHOD,
      URL
    );
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(401);
      expect(result.body.error_description).toContain("DPoP");
    }
  });

  it("accepts DPoP scheme with valid proof", async () => {
    mockJwks();
    const token = await signToken({ cnf: { jkt: dpopJkt } });
    const proof = await createDpopProof(token);
    const result = await validateToken(`DPoP ${token}`, proof, METHOD, URL);
    expect(isAuthError(result)).toBe(false);
    if (!isAuthError(result)) {
      expect(result.scheme).toBe("DPoP");
      expect(result.dpopPublicJwk).toBeDefined();
    }
  });

  it("rejects DPoP scheme without proof header", async () => {
    mockJwks();
    const token = await signToken({ cnf: { jkt: dpopJkt } });
    const result = await validateToken(`DPoP ${token}`, undefined, METHOD, URL);
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(401);
      expect(result.body.error_description).toContain("Missing DPoP proof");
    }
  });

  it("rejects DPoP proof with wrong htm", async () => {
    mockJwks();
    const token = await signToken({ cnf: { jkt: dpopJkt } });
    const proof = await createDpopProof(token, { method: "GET" });
    const result = await validateToken(`DPoP ${token}`, proof, METHOD, URL);
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.body.error_description).toContain("htm");
    }
  });

  it("rejects DPoP proof with wrong htu", async () => {
    mockJwks();
    const token = await signToken({ cnf: { jkt: dpopJkt } });
    const proof = await createDpopProof(token, { url: "http://evil.com/mcp" });
    const result = await validateToken(`DPoP ${token}`, proof, METHOD, URL);
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.body.error_description).toContain("htu");
    }
  });

  it("rejects DPoP proof with mismatched jkt", async () => {
    mockJwks();
    const token = await signToken({ cnf: { jkt: dpopJkt } });
    const proof = await createDpopProof(token, { useWrongKey: true });
    const result = await validateToken(`DPoP ${token}`, proof, METHOD, URL);
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.body.error_description).toContain("cnf.jkt");
    }
  });
});
