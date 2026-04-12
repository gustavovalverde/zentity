import { beforeEach, describe, expect, it } from "vitest";

import {
  clearIdentityPayload,
  consumeIdentityPayload,
  finalReleaseIdentityKey,
  hasIdentityPayload,
  pendingOAuthIdentityKey,
  storeIdentityPayload,
} from "../identity-delivery";

function clearIdentityPayloadStore(): void {
  const store = (
    globalThis as Record<symbol, Map<string, unknown> | undefined>
  )[Symbol.for("zentity.ephemeral-identity-claims")];
  store?.clear();
}

describe("exact identity payload delivery", () => {
  beforeEach(() => {
    clearIdentityPayloadStore();
  });

  it("keeps pending OAuth and final release bindings isolated", () => {
    const pendingKey = pendingOAuthIdentityKey("oauth-request-key");
    const finalKey = finalReleaseIdentityKey("release-1");

    storeIdentityPayload({
      bindingKey: pendingKey,
      claims: { name: "Alice" },
      scopes: ["openid", "identity.name"],
      meta: {
        clientId: "client-1",
        intentJti: "intent-oauth",
        scopeHash: "hash-oauth",
      },
      ttlMs: 5 * 60 * 1000,
    });

    expect(consumeIdentityPayload(finalKey)).toBeNull();
    expect(hasIdentityPayload(pendingKey)).toBe(true);

    storeIdentityPayload({
      bindingKey: finalKey,
      claims: { name: "Grace" },
      scopes: ["openid", "identity.name"],
      meta: {
        clientId: "client-1",
        intentJti: "intent-ciba",
        scopeHash: "hash-ciba",
      },
      ttlMs: 10 * 60 * 1000,
    });

    expect(
      consumeIdentityPayload(pendingOAuthIdentityKey("other-request"))
    ).toBeNull();
    expect(consumeIdentityPayload(pendingKey)?.claims.name).toBe("Alice");
    expect(consumeIdentityPayload(finalKey)?.claims.name).toBe("Grace");
  });

  it("clears only the addressed exact binding key", () => {
    const pendingKey = pendingOAuthIdentityKey("oauth-request-key");
    const finalKey = finalReleaseIdentityKey("release-1");

    storeIdentityPayload({
      bindingKey: pendingKey,
      claims: { name: "Alice" },
      scopes: ["openid"],
      meta: {
        clientId: "client-1",
        intentJti: "intent-oauth",
        scopeHash: "hash-oauth",
      },
      ttlMs: 5 * 60 * 1000,
    });
    storeIdentityPayload({
      bindingKey: finalKey,
      claims: { name: "Grace" },
      scopes: ["openid"],
      meta: {
        clientId: "client-1",
        intentJti: "intent-ciba",
        scopeHash: "hash-ciba",
      },
      ttlMs: 10 * 60 * 1000,
    });

    expect(clearIdentityPayload(pendingKey)).toBe(true);
    expect(hasIdentityPayload(pendingKey)).toBe(false);
    expect(hasIdentityPayload(finalKey)).toBe(true);
    expect(clearIdentityPayload(finalKey)).toBe(true);
    expect(hasIdentityPayload(finalKey)).toBe(false);
  });
});
