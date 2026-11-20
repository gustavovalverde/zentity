import { beforeEach, describe, expect, it, vi } from "vitest";

const dcrMocks = vi.hoisted(() => ({
  getRouteScenario: vi.fn(),
  isRouteScenarioId: vi.fn(),
  readDcrRegistration: vi.fn(),
  saveDcrClientId: vi.fn(),
}));

vi.mock("@/lib/dcr", () => ({
  readDcrRegistration: dcrMocks.readDcrRegistration,
  saveDcrClientId: dcrMocks.saveDcrClientId,
}));
vi.mock("@/scenarios/route-scenario-registry", () => ({
  ROUTE_SCENARIO_IDS: ["bank"],
  getRouteScenario: dcrMocks.getRouteScenario,
  isRouteScenarioId: dcrMocks.isRouteScenarioId,
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3102",
    ZENTITY_URL: "http://localhost:3000",
  },
}));

import { GET, POST } from "./route";

const SHA256_HEX = /^[0-9a-f]{64}$/;

describe("/api/dcr POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dcrMocks.isRouteScenarioId.mockReturnValue(true);
    dcrMocks.getRouteScenario.mockReturnValue({
      dcr: {
        clientName: "Velocity Private",
        requestedScopes: "openid email proof:verification",
      },
      oauthProviderId: "zentity-bank",
    });
    dcrMocks.saveDcrClientId.mockResolvedValue(undefined);
  });

  it("registers a client and persists the client_id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          client_id: "client-123",
          client_secret: "secret-123",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );

    const response = await POST(
      new Request("http://localhost:3102/api/dcr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: "bank",
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      client_id: "client-123",
      redirect_uri: "http://localhost:3102/api/auth/callback/zentity-bank",
    });
    expect(dcrMocks.saveDcrClientId).toHaveBeenCalledWith(
      "bank",
      "client-123",
      expect.stringMatching(SHA256_HEX),
      "secret-123"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/auth/oauth2/register",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const requestBody = JSON.parse(
      ((requestInit as RequestInit | undefined)?.body as string) ?? "{}"
    );
    expect(requestBody).toMatchObject({
      application_type: "native",
      token_endpoint_auth_method: "client_secret_basic",
      post_logout_redirect_uris: ["http://localhost:3102/bank"],
      rp_validity_notice_uri: "http://localhost:3102/api/auth/validity",
    });
    expect(requestBody).not.toHaveProperty("backchannel_logout_uri");
  });

  it("returns JSON when local persistence fails after upstream registration", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          client_id: "client-123",
          client_secret: "secret-123",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    dcrMocks.saveDcrClientId.mockRejectedValueOnce(
      new Error("SQLITE_ERROR: no such table: dcr_client")
    );

    const response = await POST(
      new Request("http://localhost:3102/api/dcr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: "bank",
        }),
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error:
        "Failed to persist DCR client: SQLITE_ERROR: no such table: dcr_client",
    });
  });
});

describe("/api/dcr GET (self-heal)", () => {
  const AETHER_LIKE = {
    dcr: {
      authorizationDetailsTypes: ["payment_authorization"],
      clientName: "Aether AI",
      grantTypes: ["authorization_code", "urn:openid:params:grant-type:ciba"],
      requestedScopes: "openid email",
    },
    oauthProviderId: "zentity-bank",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    dcrMocks.isRouteScenarioId.mockReturnValue(true);
    dcrMocks.getRouteScenario.mockReturnValue(AETHER_LIKE);
    dcrMocks.saveDcrClientId.mockResolvedValue(undefined);
  });

  function parLive() {
    return new Response(
      JSON.stringify({
        request_uri: "urn:ietf:params:oauth:request_uri:probe",
        expires_in: 60,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  function parInvalidClient() {
    return new Response(
      JSON.stringify({
        error: "invalid_client",
        error_description: "client not found",
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  function registered(clientId: string) {
    return new Response(
      JSON.stringify({ client_id: clientId, client_secret: "secret" }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  }

  /** The fingerprint the route stores for the scenario's current body. */
  async function currentFingerprint(): Promise<string> {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(registered("probe"));
    await POST(
      new Request("http://localhost:3102/api/dcr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: "bank" }),
      })
    );
    const fingerprint = dcrMocks.saveDcrClientId.mock.calls.at(-1)?.[2];
    vi.restoreAllMocks();
    dcrMocks.saveDcrClientId.mockClear();
    return fingerprint as string;
  }

  function registrationBodyOf(call: unknown[] | undefined) {
    return JSON.parse(((call?.[1] as RequestInit).body as string) ?? "{}");
  }

  it("returns registered:false when nothing is cached", async () => {
    dcrMocks.readDcrRegistration.mockResolvedValue(null);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await GET(
      new Request("http://localhost:3102/api/dcr?scenarioId=bank")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ registered: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a current cached client when Zentity still recognizes it", async () => {
    dcrMocks.readDcrRegistration.mockResolvedValue({
      clientId: "live-client",
      registrationFingerprint: await currentFingerprint(),
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parLive());

    const response = await GET(
      new Request("http://localhost:3102/api/dcr?scenarioId=bank")
    );

    await expect(response.json()).resolves.toEqual({
      registered: true,
      client_id: "live-client",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:3000/api/auth/oauth2/par"
    );
    expect(dcrMocks.saveDcrClientId).not.toHaveBeenCalled();
  });

  it("re-registers when Zentity has forgotten the cached client", async () => {
    dcrMocks.readDcrRegistration.mockResolvedValue({
      clientId: "stale-client",
      registrationFingerprint: await currentFingerprint(),
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(parInvalidClient())
      .mockResolvedValueOnce(registered("fresh-client"));

    const response = await GET(
      new Request("http://localhost:3102/api/dcr?scenarioId=bank")
    );

    await expect(response.json()).resolves.toEqual({
      registered: true,
      client_id: "fresh-client",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:3000/api/auth/oauth2/register"
    );
    expect(dcrMocks.saveDcrClientId).toHaveBeenCalledWith(
      "bank",
      "fresh-client",
      expect.stringMatching(SHA256_HEX),
      "secret"
    );
  });

  // A client cached before its registration body changed (for example, before
  // it declared authorization_details_types) is replaced, though still live.
  it.each([
    ["has no fingerprint", null],
    ["was registered from another body", "0".repeat(64)],
  ])("re-registers a cached client that %s", async (_case, fingerprint) => {
    dcrMocks.readDcrRegistration.mockResolvedValue({
      clientId: "old-client",
      registrationFingerprint: fingerprint,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(registered("fresh-client"));

    const response = await GET(
      new Request("http://localhost:3102/api/dcr?scenarioId=bank")
    );

    await expect(response.json()).resolves.toEqual({
      registered: true,
      client_id: "fresh-client",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:3000/api/auth/oauth2/register"
    );
    expect(registrationBodyOf(fetchMock.mock.calls[0])).toMatchObject({
      authorization_details_types: ["payment_authorization"],
    });
  });

  it("returns 400 for an invalid scenarioId", async () => {
    dcrMocks.isRouteScenarioId.mockReturnValue(false);

    const response = await GET(
      new Request("http://localhost:3102/api/dcr?scenarioId=nope")
    );

    expect(response.status).toBe(400);
  });
});
