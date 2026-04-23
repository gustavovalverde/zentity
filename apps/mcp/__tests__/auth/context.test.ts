import { beforeEach, describe, expect, it } from "vitest";
import {
  type AuthContext,
  getAuthContext,
  requireRuntimeState,
  runWithAuth,
  setDefaultAuth,
  tryGetRuntimeState,
} from "../../src/auth/context.js";
import { agentRuntimeStateStore } from "../../src/auth/runtime-state.js";

const dpopKey = {
  privateJwk: { kty: "EC", crv: "P-256" },
  publicJwk: { kty: "EC", crv: "P-256" },
};

function makeOAuth() {
  return {
    accessToken: "token-abc",
    accountSub: "sub-1",
    clientId: "client-1",
    dpopKey,
    loginHint: "user@example.com",
    scopes: ["openid"],
  };
}

const mockRuntime = {
  display: { name: "test-agent" },
  grants: [],
  hostId: "host-1",
  sessionDid: "did:key:zSession",
  sessionId: "session-1",
  sessionPrivateKey: { kty: "OKP", crv: "Ed25519" },
  sessionPublicKey: { kty: "OKP", crv: "Ed25519" },
  status: "active",
};

describe("AuthContext", () => {
  beforeEach(() => {
    setDefaultAuth(undefined);
    agentRuntimeStateStore.clear();
  });

  it("provides auth context inside runWithAuth", () => {
    const ctx: AuthContext = { oauth: makeOAuth() };

    const result = runWithAuth(ctx, () => {
      const retrieved = getAuthContext();
      return retrieved.oauth.loginHint;
    });

    expect(result).toBe("user@example.com");
  });

  it("throws when accessed outside runWithAuth", () => {
    expect(() => getAuthContext()).toThrow("Not authenticated");
  });

  describe("tryGetRuntimeState", () => {
    it("returns undefined when no runtime is available", () => {
      const ctx: AuthContext = { oauth: makeOAuth() };
      setDefaultAuth(ctx);

      expect(tryGetRuntimeState()).toBeUndefined();
    });

    it("returns runtime from auth context", () => {
      const ctx: AuthContext = {
        oauth: makeOAuth(),
        runtime: mockRuntime,
      };
      setDefaultAuth(ctx);

      expect(tryGetRuntimeState()).toBe(mockRuntime);
    });

    it("returns runtime from agentRuntimeStateStore as fallback", () => {
      const ctx: AuthContext = { oauth: makeOAuth() };
      setDefaultAuth(ctx);
      agentRuntimeStateStore.setState(mockRuntime);

      expect(tryGetRuntimeState()).toBe(mockRuntime);
    });
  });

  describe("requireRuntimeState", () => {
    it("throws when no runtime is available", () => {
      const ctx: AuthContext = { oauth: makeOAuth() };
      setDefaultAuth(ctx);

      expect(() => requireRuntimeState()).toThrow(
        "Agent runtime is not initialized"
      );
    });

    it("returns runtime when available", () => {
      const ctx: AuthContext = {
        oauth: makeOAuth(),
        runtime: mockRuntime,
      };
      setDefaultAuth(ctx);

      expect(requireRuntimeState()).toBe(mockRuntime);
    });
  });
});
