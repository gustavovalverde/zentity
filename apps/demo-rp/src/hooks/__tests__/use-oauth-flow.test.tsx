import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  data: null as {
    user: { claims?: Record<string, Record<string, unknown>> };
  } | null,
  isPending: false,
}));

const signInMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { oauth2: signInMock } },
  useSession: () => sessionMock,
  signOut: vi.fn(),
}));

import type { Scenario } from "@/lib/scenarios";
import { useOAuthFlow } from "../use-oauth-flow";

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "bank",
    name: "Test Bank",
    tagline: "Test",
    description: "Test",
    providerId: "zentity-bank",
    signInScopes: ["openid", "email", "proof:verification"],
    stepUpScopes: ["identity.name"],
    stepUpClaimKeys: ["name"],
    stepUpAction: "Open Account",
    dcr: { clientName: "Test", defaultScopes: "openid email" },
    compliance: [],
    notShared: [],
    ...overrides,
  } as Scenario;
}

describe("useOAuthFlow", () => {
  it("handleSignIn calls signIn.oauth2 with providerId and no scopes", async () => {
    sessionMock.data = null;
    const scenario = makeScenario();
    const { result } = renderHook(() => useOAuthFlow(scenario));

    await result.current.handleSignIn();

    expect(signInMock).toHaveBeenCalledWith({
      providerId: "zentity-bank",
      callbackURL: "/bank",
    });
  });

  it("handleStepUp calls signIn.oauth2 with merged signIn + stepUp scopes", async () => {
    sessionMock.data = {
      user: {
        claims: { "zentity-bank": { email: "a@b.com" } },
      },
    };
    const scenario = makeScenario();
    const { result } = renderHook(() => useOAuthFlow(scenario));

    await result.current.handleStepUp();

    expect(signInMock).toHaveBeenCalledWith({
      providerId: "zentity-bank",
      callbackURL: "/bank",
      scopes: ["openid", "email", "proof:verification", "identity.name"],
    });
  });

  it("isAuthenticated is true when claims exist for the provider", () => {
    sessionMock.data = {
      user: {
        claims: { "zentity-bank": { email: "a@b.com" } },
      },
    };
    const scenario = makeScenario();
    const { result } = renderHook(() => useOAuthFlow(scenario));

    expect(result.current.isAuthenticated).toBe(true);
  });

  it("isSteppedUp is true when all stepUpClaimKeys are present", () => {
    sessionMock.data = {
      user: {
        claims: { "zentity-bank": { name: "Ada Lovelace" } },
      },
    };
    const scenario = makeScenario();
    const { result } = renderHook(() => useOAuthFlow(scenario));

    expect(result.current.isSteppedUp).toBe(true);
  });

  it("isSteppedUp is false when some stepUpClaimKeys are missing", () => {
    sessionMock.data = {
      user: {
        claims: { "zentity-bank": { email: "a@b.com" } },
      },
    };
    const scenario = makeScenario();
    const { result } = renderHook(() => useOAuthFlow(scenario));

    expect(result.current.isSteppedUp).toBe(false);
  });
});
