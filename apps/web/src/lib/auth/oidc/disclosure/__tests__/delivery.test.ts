import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getIdentityIntentKey } from "@/lib/privacy/primitives/derived-keys";

const { mockInfo } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: {
    child: () => ({ info: mockInfo, warn: vi.fn() }),
  },
}));

import {
  clearIdentityPayload,
  consumeIdentityPayload,
  createIdentityIntentToken,
  createScopeHash,
  EPHEMERAL_TTL_MS,
  finalReleaseIdentityKey,
  hasIdentityPayload,
  pendingOAuthIdentityKey,
  promoteIdentityPayload,
  storeIdentityPayload,
  verifyIdentityIntentToken,
} from "../delivery";

function clearIdentityPayloadStore(): void {
  const store = (
    globalThis as Record<symbol, Map<string, unknown> | undefined>
  )[Symbol.for("zentity.ephemeral-identity-claims")];
  store?.clear();
}

function makeMeta(intentJti: string, scopes: string[]) {
  return {
    clientId: "client-1",
    scopeHash: createScopeHash(scopes),
    intentJti,
  };
}

describe("exact-key identity payload store", () => {
  beforeEach(() => {
    vi.useRealTimers();
    clearIdentityPayloadStore();
    mockInfo.mockClear();
  });

  it("stores and consumes a payload only by its exact binding key", () => {
    const bindingKey = pendingOAuthIdentityKey("oauth-request-key");
    const scopes = ["openid", "identity.name"];

    expect(
      storeIdentityPayload({
        bindingKey,
        claims: { given_name: "Ada", family_name: "Lovelace" },
        scopes,
        meta: makeMeta("intent-1", scopes),
        ttlMs: EPHEMERAL_TTL_MS,
      })
    ).toEqual({ ok: true });

    expect(hasIdentityPayload(bindingKey)).toBe(true);

    const consumed = consumeIdentityPayload(bindingKey);
    expect(consumed?.claims).toEqual({
      given_name: "Ada",
      family_name: "Lovelace",
    });
    expect(consumed?.meta.intentJti).toBe("intent-1");
    expect(consumed?.scopes).toEqual(scopes);
    expect(consumeIdentityPayload(bindingKey)).toBeNull();
  });

  it("does not resolve by a user-only or cross-flow key", () => {
    const pendingKey = pendingOAuthIdentityKey("oauth-request-key");
    const finalKey = finalReleaseIdentityKey("release-1");
    const scopes = ["openid", "identity.name"];

    storeIdentityPayload({
      bindingKey: pendingKey,
      claims: { given_name: "Ada" },
      scopes,
      meta: makeMeta("intent-oauth", scopes),
      ttlMs: EPHEMERAL_TTL_MS,
    });

    expect(consumeIdentityPayload(finalKey)).toBeNull();

    storeIdentityPayload({
      bindingKey: finalKey,
      claims: { given_name: "Grace" },
      scopes,
      meta: makeMeta("intent-ciba", scopes),
      ttlMs: EPHEMERAL_TTL_MS,
    });

    expect(
      consumeIdentityPayload(pendingOAuthIdentityKey("other-request"))
    ).toBeNull();
    expect(consumeIdentityPayload(pendingKey)?.claims.given_name).toBe("Ada");
    expect(consumeIdentityPayload(finalKey)?.claims.given_name).toBe("Grace");
  });

  it("promotes a pending payload to the final release key exactly once", () => {
    const pendingKey = pendingOAuthIdentityKey("oauth-request-key");
    const finalKey = finalReleaseIdentityKey("release-1");
    const scopes = ["openid", "identity.dob"];

    storeIdentityPayload({
      bindingKey: pendingKey,
      claims: { birthdate: "1990-01-01" },
      scopes,
      meta: makeMeta("intent-promote", scopes),
      ttlMs: EPHEMERAL_TTL_MS,
    });

    expect(promoteIdentityPayload(pendingKey, finalKey)).toEqual({ ok: true });
    expect(consumeIdentityPayload(pendingKey)).toBeNull();

    const consumed = consumeIdentityPayload(finalKey);
    expect(consumed?.claims).toEqual({ birthdate: "1990-01-01" });
    expect(consumed?.meta.intentJti).toBe("intent-promote");
    expect(consumeIdentityPayload(finalKey)).toBeNull();
  });

  it("rejects replacement at the same exact key", () => {
    const bindingKey = finalReleaseIdentityKey("release-1");
    const scopes = ["openid", "identity.name"];

    expect(
      storeIdentityPayload({
        bindingKey,
        claims: { given_name: "Ada" },
        scopes,
        meta: makeMeta("intent-original", scopes),
        ttlMs: EPHEMERAL_TTL_MS,
      })
    ).toEqual({ ok: true });

    expect(
      storeIdentityPayload({
        bindingKey,
        claims: { given_name: "Grace" },
        scopes,
        meta: makeMeta("intent-replacement", scopes),
        ttlMs: EPHEMERAL_TTL_MS,
      })
    ).toEqual({ ok: false, reason: "concurrent_stage" });

    expect(consumeIdentityPayload(bindingKey)?.claims.given_name).toBe("Ada");
  });

  it("clears the addressed binding without affecting unrelated keys", () => {
    const pendingKey = pendingOAuthIdentityKey("oauth-request-key");
    const finalKey = finalReleaseIdentityKey("release-1");
    const scopes = ["openid", "identity.name"];

    storeIdentityPayload({
      bindingKey: pendingKey,
      claims: { given_name: "Ada" },
      scopes,
      meta: makeMeta("intent-clear", scopes),
      ttlMs: EPHEMERAL_TTL_MS,
    });
    storeIdentityPayload({
      bindingKey: finalKey,
      claims: { given_name: "Grace" },
      scopes,
      meta: makeMeta("intent-clear-ciba", scopes),
      ttlMs: EPHEMERAL_TTL_MS,
    });

    expect(clearIdentityPayload(pendingKey)).toBe(true);
    expect(hasIdentityPayload(pendingKey)).toBe(false);
    expect(hasIdentityPayload(finalKey)).toBe(true);
    expect(clearIdentityPayload(pendingKey)).toBe(false);
    expect(consumeIdentityPayload(finalKey)?.claims.given_name).toBe("Grace");
  });
});

describe("identity intent tokens", () => {
  const input = {
    userId: "user-1",
    clientId: "client-1",
    authReqId: "auth-req-1",
    scopes: ["openid", "identity.name"],
  };

  it("round-trips the bound user, client, and scope hash", async () => {
    const intent = await createIdentityIntentToken(input);

    const payload = await verifyIdentityIntentToken(intent.intentToken);

    expect(payload).toEqual({
      jti: intent.jti,
      userId: "user-1",
      clientId: "client-1",
      authReqId: "auth-req-1",
      scopeHash: createScopeHash(input.scopes),
      exp: intent.expiresAt,
    });
  });

  it("reports an expired token as expired", async () => {
    const intent = await createIdentityIntentToken({
      ...input,
      ttlSeconds: -1,
    });

    await expect(verifyIdentityIntentToken(intent.intentToken)).rejects.toThrow(
      "expired_intent_token"
    );
  });

  it("rejects a token whose payload was changed", async () => {
    const { intentToken } = await createIdentityIntentToken(input);
    const [header, , signature] = intentToken.split(".");
    const forged = Buffer.from(
      JSON.stringify({ userId: "user-2", clientId: "client-1" })
    ).toString("base64url");

    await expect(
      verifyIdentityIntentToken(`${header}.${forged}.${signature}`)
    ).rejects.toThrow("invalid_intent_token");
  });

  it("rejects another JWT type signed with the same key", async () => {
    const otherType = await new SignJWT({ userId: "user-1" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime("2m")
      .sign(new TextEncoder().encode(getIdentityIntentKey()));

    await expect(verifyIdentityIntentToken(otherType)).rejects.toThrow(
      "invalid_intent_token"
    );
  });
});
