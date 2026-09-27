import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  readZentitySubject: vi.fn(),
  pingRows: [] as Array<{
    authReqId: string;
    notificationToken: string;
    received: boolean;
    userId: string;
  }>,
  fetch: vi.fn(),
  requestTokenEndpoint: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: vi.fn(async () => ({ api: { getSession: mocks.getSession } })),
}));

vi.mock("@/lib/dcr", () => ({
  readDcrClient: vi.fn(async () => ({
    clientId: "aether-client",
    clientSecret: null,
  })),
  readZentitySubject: mocks.readZentitySubject,
}));

vi.mock("@/lib/agent-runtime", () => ({
  prepareAgentAssertionForScenario: vi.fn(async () => null),
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "http://demo.localhost:3102",
    ZENTITY_URL: "http://zentity.localhost:3000",
  },
}));

vi.mock("@zentity/sdk/rp", () => ({
  createDpopClient: vi.fn(async () => ({
    keyPair: { publicJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" } },
  })),
  fetchUserInfo: vi.fn(async () => ({ sub: "pairwise-sub" })),
  requestTokenEndpoint: mocks.requestTokenEndpoint,
}));

vi.mock("jose", () => ({
  calculateJwkThumbprint: vi.fn(async () => "jkt"),
}));

vi.mock("@/lib/db/connection", () => {
  const matches = (where: unknown, row: Record<string, unknown>) =>
    (where as (r: Record<string, unknown>) => boolean)(row);
  return {
    getDb: () => ({
      insert: () => ({
        values: (value: (typeof mocks.pingRows)[number]) => ({
          onConflictDoNothing: () => {
            mocks.pingRows.push({ ...value, received: false });
            return Promise.resolve();
          },
        }),
      }),
      query: {
        cibaPings: {
          findFirst: async ({ where }: { where: unknown }) =>
            mocks.pingRows.find((row) => matches(where, row)),
        },
      },
    }),
  };
});

vi.mock("drizzle-orm", () => ({
  and:
    (...predicates: Array<(row: Record<string, unknown>) => boolean>) =>
    (row: Record<string, unknown>) =>
      predicates.every((predicate) => predicate(row)),
  eq:
    (column: { name: string }, value: unknown) =>
    (row: Record<string, unknown>) =>
      row[column.name] === value,
}));

vi.mock("@/lib/db/schema", () => ({
  cibaPings: {
    authReqId: { name: "authReqId" },
    userId: { name: "userId" },
  },
}));

const { POST } = await import("./route");

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://demo.localhost:3102/api/ciba", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/ciba", () => {
  beforeEach(() => {
    mocks.pingRows.length = 0;
    mocks.getSession.mockResolvedValue({ user: { id: "demo-user" } });
    mocks.readZentitySubject.mockResolvedValue("pairwise-sub");
    mocks.fetch.mockResolvedValue(
      Response.json({ auth_req_id: "req-1", expires_in: 300, interval: 5 })
    );
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.requestTokenEndpoint.mockResolvedValue({
      body: { access_token: "at", token_type: "DPoP" },
      response: new Response(null, { status: 200 }),
    });
  });

  it("names the signed-in user by the subject Zentity issued to the scenario client", async () => {
    const response = await post({
      action: "authorize",
      scenarioId: "aether",
      loginHint: "victim@example.com",
      scope: "openid",
    });

    expect(response.status).toBe(200);
    const sent = JSON.parse(
      (mocks.fetch.mock.calls[0]?.[1] as RequestInit).body as string
    ) as Record<string, unknown>;
    expect(sent.login_hint).toBe("pairwise-sub");
    expect(mocks.readZentitySubject).toHaveBeenCalledWith(
      "aether",
      "demo-user"
    );
  });

  it("refuses to authorize when the user never signed in with the scenario", async () => {
    mocks.readZentitySubject.mockResolvedValue(null);

    const response = await post({
      action: "authorize",
      scenarioId: "aether",
      scope: "openid",
    });

    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("only returns tokens to the session that started the request", async () => {
    await post({ action: "authorize", scenarioId: "aether", scope: "openid" });

    mocks.getSession.mockResolvedValue({ user: { id: "someone-else" } });
    const stranger = await post({
      action: "token",
      scenarioId: "aether",
      authReqId: "req-1",
    });
    mocks.getSession.mockResolvedValue(null);
    const anonymous = await post({
      action: "token",
      scenarioId: "aether",
      authReqId: "req-1",
    });

    expect(stranger.status).toBe(404);
    expect(anonymous.status).toBe(401);
    expect(mocks.requestTokenEndpoint).not.toHaveBeenCalled();

    mocks.getSession.mockResolvedValue({ user: { id: "demo-user" } });
    const owner = await post({
      action: "token",
      scenarioId: "aether",
      authReqId: "req-1",
    });
    expect(owner.status).toBe(200);
  });
});
