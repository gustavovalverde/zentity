import { deriveDpopKeyPairFromSeed } from "@zentity/sdk/rp";
import { createDpopProof } from "better-auth/oauth2/dpop-client";
import { calculateJwkThumbprint, decodeProtectedHeader, type JWK } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  env: {} as { OAUTH_DPOP_KEY_SEED?: string; ZPAY_DPOP_KEY_SEED?: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => mockEnv);

const SIGN_IN_SEED = "sign-in-dpop-seed-at-least-32-characters";
const ZPAY_SEED = "zpay-dpop-seed-at-least-32-characters-x";

function loadModule() {
  vi.resetModules();
  return import("./oauth-dpop-client");
}

describe("oauth-dpop-client", () => {
  beforeEach(() => {
    mockEnv.env = {};
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns one key pair and one client for every caller", async () => {
    mockEnv.env = { OAUTH_DPOP_KEY_SEED: SIGN_IN_SEED };
    const { getOAuthDpopClient, getOAuthDpopKeyPair } = await loadModule();

    const [firstPair, secondPair, firstClient, secondClient] =
      await Promise.all([
        getOAuthDpopKeyPair(),
        getOAuthDpopKeyPair(),
        getOAuthDpopClient(),
        getOAuthDpopClient(),
      ]);

    expect(secondPair).toBe(firstPair);
    expect(secondClient).toBe(firstClient);
    expect(firstPair.privateKey.type).toBe("private");
    expect(firstPair.privateKey.extractable).toBe(false);
    expect(firstPair.publicKey.extractable).toBe(true);
  });

  it("derives a stable jkt from the seed, shared by both key forms", async () => {
    mockEnv.env = { OAUTH_DPOP_KEY_SEED: SIGN_IN_SEED };
    const first = await loadModule();
    const jkt = await first.getOAuthDpopJkt();
    const client = await first.getOAuthDpopClient();

    const second = await loadModule();

    await expect(second.getOAuthDpopJkt()).resolves.toBe(jkt);
    await expect(
      calculateJwkThumbprint(client.keyPair.publicJwk)
    ).resolves.toBe(jkt);
    const zpayKey = await deriveDpopKeyPairFromSeed(ZPAY_SEED);
    await expect(calculateJwkThumbprint(zpayKey.publicJwk)).resolves.not.toBe(
      jkt
    );
  });

  it("signs generic OAuth proofs whose key is the advertised jkt", async () => {
    mockEnv.env = { OAUTH_DPOP_KEY_SEED: SIGN_IN_SEED };
    const { getOAuthDpopJkt, getOAuthDpopKeyPair } = await loadModule();

    const proof = await createDpopProof({
      keyPair: await getOAuthDpopKeyPair(),
      method: "POST",
      url: "http://zentity.example/api/auth/oauth2/token",
    });
    const { jwk } = decodeProtectedHeader(proof);

    expect(jwk).toBeDefined();
    await expect(calculateJwkThumbprint(jwk as JWK)).resolves.toBe(
      await getOAuthDpopJkt()
    );
  });

  it("refuses the payment channel's seed", async () => {
    mockEnv.env = {
      OAUTH_DPOP_KEY_SEED: ZPAY_SEED,
      ZPAY_DPOP_KEY_SEED: ZPAY_SEED,
    };
    const { getOAuthDpopKeyPair } = await loadModule();

    await expect(getOAuthDpopKeyPair()).rejects.toThrow(
      "OAUTH_DPOP_KEY_SEED must differ from ZPAY_DPOP_KEY_SEED"
    );
  });

  it("falls back to one ephemeral key with a single warning in development", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { getOAuthDpopJkt } = await loadModule();

    const jkt = await getOAuthDpopJkt();

    await expect(getOAuthDpopJkt()).resolves.toBe(jkt);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain(
      "OAUTH_DPOP_KEY_SEED unset"
    );
  });

  it("requires the seed in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getOAuthDpopKeyPair } = await loadModule();

    await expect(getOAuthDpopKeyPair()).rejects.toThrow(
      "OAUTH_DPOP_KEY_SEED is required in production"
    );
  });
});
