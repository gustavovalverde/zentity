import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("jose", () => {
  class MockSignJWT {
    private readonly claims: Record<string, unknown>;

    constructor(claims: Record<string, unknown>) {
      this.claims = { ...claims };
    }

    setExpirationTime() {
      return this;
    }

    setIssuedAt() {
      return this;
    }

    setIssuer(issuer: string) {
      this.claims.iss = issuer;
      return this;
    }

    setJti(jti: string) {
      this.claims.jti = jti;
      return this;
    }

    setProtectedHeader() {
      return this;
    }

    setSubject(subject: string) {
      this.claims.sub = subject;
      return this;
    }

    sign() {
      return Promise.resolve(JSON.stringify(this.claims));
    }
  }

  return {
    exportJWK: vi.fn(async () => ({
      crv: "Ed25519",
      kty: "OKP",
      x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
    })),
    generateKeyPair: vi.fn(async () => ({ privateKey: {}, publicKey: {} })),
    importJWK: vi.fn(async () => ({ type: "private-key" })),
    SignJWT: MockSignJWT,
  };
});

interface RuntimeRow {
  createdAt: Date;
  displayName: string;
  hostId: string | null;
  hostPrivateJwk: string;
  hostPublicJwk: string;
  id: string;
  model: string;
  providerId: string;
  runtime: string;
  sessionId: string | null;
  sessionPrivateJwk: string | null;
  sessionPublicJwk: string | null;
  updatedAt: Date;
  userId: string;
  version: string;
}

const testState = vi.hoisted(() => ({
  db: null as ReturnType<typeof createDbMock> | null,
  dpopClient: {
    proofFor: vi.fn(async () => "dpop-proof"),
    withNonceRetry: vi.fn(
      async (
        attempt: (
          nonce?: string
        ) => Promise<{ response: Response; result: Response }>
      ) => await attempt()
    ),
  },
  fetchMock: vi.fn<typeof fetch>(),
  readDcrClient: vi.fn(async () => ({
    clientId: "client-123",
    clientSecret: null,
  })),
  signAttestationHeaders: vi.fn(async () => ({
    attestation: "attestation.jwt",
    attestationPop: "attestation-pop.jwt",
  })),
}));

vi.mock("@/lib/attestation", () => ({
  signAttestationHeaders: (
    ...args: Parameters<typeof testState.signAttestationHeaders>
  ) => testState.signAttestationHeaders(...args),
}));

vi.mock("@/lib/db/connection", () => ({
  getDb: () => testState.db,
}));

vi.mock("@/lib/dcr", () => ({
  readDcrClient: (...args: Parameters<typeof testState.readDcrClient>) =>
    testState.readDcrClient(...args),
}));

vi.mock("@zentity/sdk/rp", () => ({
  createDpopClientFromKeyPair: async () => testState.dpopClient,
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3102",
    ZENTITY_URL: "http://localhost:3000",
  },
}));

import { prepareAgentAssertionForProvider } from "./agent-runtime";

function createDbMock(state: {
  accountRow?: {
    accessToken: string | null;
    accessTokenExpiresAt: string | null;
  } | null;
  runtimeRow: RuntimeRow | null;
}) {
  return {
    insert: vi.fn(() => ({
      values: vi.fn((values: Partial<RuntimeRow>) => ({
        returning: vi.fn(() => {
          const row: RuntimeRow = {
            createdAt: new Date(),
            displayName: "Aether AI",
            hostId: null,
            hostPrivateJwk: "{}",
            hostPublicJwk: "{}",
            id: "runtime-new",
            model: "gpt-4",
            providerId: "bank::agent-runtime:v2:attested",
            runtime: "demo-rp",
            sessionId: null,
            sessionPrivateJwk: null,
            sessionPublicJwk: null,
            updatedAt: new Date(),
            userId: "user-1",
            version: "1.0",
            ...values,
          };
          state.runtimeRow = row;
          return Promise.resolve([row]);
        }),
      })),
    })),
    query: {
      account: {
        findFirst: vi.fn(
          async () =>
            state.accountRow ?? {
              accessToken: "access-token",
              accessTokenExpiresAt: null,
            }
        ),
      },
      agentRuntime: {
        findFirst: vi.fn(async () => state.runtimeRow),
      },
      oauthDpopKey: {
        findFirst: vi.fn(async () => ({
          accessToken: "access-token",
          privateJwk: "{}",
          providerId: "bank",
          publicJwk: "{}",
        })),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((changes: Partial<RuntimeRow>) => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => {
            if (!state.runtimeRow) {
              throw new Error("Missing runtime row");
            }
            state.runtimeRow = {
              ...state.runtimeRow,
              ...changes,
            };
            return Promise.resolve([state.runtimeRow]);
          }),
        })),
      })),
    })),
  };
}

function createRuntimeRow(overrides: Partial<RuntimeRow> = {}): RuntimeRow {
  return {
    createdAt: new Date(),
    displayName: "Aether AI",
    hostId: "host-1",
    hostPrivateJwk: JSON.stringify({
      crv: "Ed25519",
      d: "host-private",
      kty: "OKP",
    }),
    hostPublicJwk: JSON.stringify({
      crv: "Ed25519",
      kty: "OKP",
      x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    }),
    id: "runtime-1",
    model: "gpt-4",
    providerId: "bank::agent-runtime:v2:attested",
    runtime: "demo-rp",
    sessionId: "session-old",
    sessionPrivateJwk: JSON.stringify({
      crv: "Ed25519",
      d: "session-private-old",
      kty: "OKP",
    }),
    sessionPublicJwk: JSON.stringify({
      crv: "Ed25519",
      kty: "OKP",
      x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
    }),
    updatedAt: new Date(),
    userId: "user-1",
    version: "1.0",
    ...overrides,
  };
}

describe("prepareAgentAssertionForProvider", () => {
  beforeEach(() => {
    const dbState = { runtimeRow: null as RuntimeRow | null };
    testState.db = createDbMock(dbState);
    testState.fetchMock.mockReset();
    testState.readDcrClient.mockClear();
    testState.signAttestationHeaders.mockClear();
    testState.dpopClient.proofFor.mockClear();
    testState.dpopClient.withNonceRetry.mockClear();
    vi.stubGlobal("fetch", testState.fetchMock);
  });

  it("rejects attested flows when host registration falls back to unverified", async () => {
    testState.fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "bootstrap-token",
            expires_in: 300,
            scope: "agent:host.register agent:session.register",
            token_type: "DPoP",
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attestation_tier: "unverified",
            did: "did:key:z6Mkg3ShJxrz8J4kizVwR6cJQ2s9wZ5x1hQxQds2z7Q9b3Zs",
            hostId: "host-1",
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        )
      );

    await expect(
      prepareAgentAssertionForProvider({
        bindingMessage: "Verified Aether AI requests purchase: Macallan 18",
        providerId: "bank",
        trustTier: "attested",
        userId: "user-1",
      })
    ).rejects.toThrow(
      "Host registration did not satisfy the required attested trust tier"
    );

    expect(testState.fetchMock).toHaveBeenCalledTimes(2);
    expect(testState.fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/api/auth/oauth2/token",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(testState.fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/api/auth/agent/host/register",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "DPoP bootstrap-token",
        }),
        method: "POST",
      })
    );
  });

  it("asks for re-authentication when the saved OAuth token is rejected", async () => {
    testState.fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "bootstrap-token",
            expires_in: 300,
            scope: "agent:host.register agent:session.register",
            token_type: "DPoP",
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Bootstrap access token required" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 401,
          }
        )
      );

    await expect(
      prepareAgentAssertionForProvider({
        bindingMessage: "Aether AI requests purchase: Sony WH-1000XM5",
        providerId: "bank",
        trustTier: "registered",
        userId: "user-1",
      })
    ).rejects.toThrow(
      "OAuth access token expired or is no longer valid. Sign in again."
    );
  });

  it("re-registers attested sessions instead of reusing stale local session state", async () => {
    const runtimeRow = createRuntimeRow();
    const dbState = { runtimeRow };
    testState.db = createDbMock(dbState);

    testState.fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "bootstrap-token",
            expires_in: 300,
            scope: "agent:host.register agent:session.register",
            token_type: "DPoP",
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attestation_tier: "attested",
            did: "did:key:z6Mkg3ShJxrz8J4kizVwR6cJQ2s9wZ5x1hQxQds2z7Q9b3Zs",
            hostId: "host-1",
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: "did:key:z6Mkg3ShJxrz8J4kizVwR6cJQ2s9wZ5x1hQxQds2z7Q9b3Zs",
            sessionId: "session-new",
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 201,
          }
        )
      );

    const assertion = await prepareAgentAssertionForProvider({
      bindingMessage: "Verified Aether AI requests purchase: Macallan 18",
      providerId: "bank",
      trustTier: "attested",
      userId: "user-1",
    });

    expect(assertion).toEqual(expect.any(String));
    expect(testState.fetchMock).toHaveBeenCalledTimes(3);
    expect(dbState.runtimeRow.sessionId).toBe("session-new");
    expect(testState.fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://localhost:3000/api/auth/agent/register",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "DPoP bootstrap-token",
        }),
        method: "POST",
      })
    );
  });
});
