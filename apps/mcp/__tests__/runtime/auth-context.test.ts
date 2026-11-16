import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { CibaAuthorizationError } from "@zentity/sdk";
import { AGENT_SESSION_INACTIVE_DESCRIPTION } from "@zentity/sdk/agent-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuthContext,
  getAuthContext,
  requireAuth,
  runWithAuth,
  setProcessAuthResolver,
  withAgentSession,
  withToolAuth,
} from "../../src/runtime/auth-context.js";

function makeAuth(accountSub: string): AuthContext {
  return {
    oauth: {
      accessToken: "token-abc",
      accountSub,
      clientId: "client-1",
      dpopClient: {} as AuthContext["oauth"]["dpopClient"],
      dpopKey: {} as AuthContext["oauth"]["dpopKey"],
      scopes: ["openid"],
    },
  };
}

const server = {
  server: { getClientVersion: () => ({ name: "claude-code", version: "1.0" }) },
} as unknown as McpServer;
const ctx = { mcpReq: {} } as unknown as ServerContext;

describe("auth context", () => {
  afterEach(() => {
    setProcessAuthResolver(undefined);
  });

  it("exposes the request-scoped context inside runWithAuth", () => {
    const sub = runWithAuth(
      makeAuth("sub-1"),
      () => getAuthContext().oauth.accountSub
    );
    expect(sub).toBe("sub-1");
  });

  it("throws outside any auth scope", () => {
    expect(() => getAuthContext()).toThrow("Not authenticated");
  });

  it("prefers the request-scoped context over the process resolver", async () => {
    const resolver = vi.fn(() => Promise.resolve(makeAuth("process")));
    setProcessAuthResolver(resolver);

    const auth = await runWithAuth(makeAuth("request"), () => requireAuth());

    expect(auth.oauth.accountSub).toBe("request");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("resolves the process context with the caller's client identity", async () => {
    const resolver = vi.fn(() => Promise.resolve(makeAuth("process")));
    setProcessAuthResolver(resolver);

    const auth = await requireAuth({ name: "codex-cli", version: "2.0" });

    expect(auth.oauth.accountSub).toBe("process");
    expect(resolver).toHaveBeenCalledWith({
      name: "codex-cli",
      version: "2.0",
    });
  });

  it("rejects when neither a request scope nor a resolver exists", async () => {
    await expect(requireAuth()).rejects.toThrow("Not authenticated");
  });

  it("runs tool handlers inside the resolved auth context", async () => {
    const resolver = vi.fn(() => Promise.resolve(makeAuth("tool-user")));
    setProcessAuthResolver(resolver);
    const tool = withToolAuth(server, async () =>
      Promise.resolve(getAuthContext().oauth.accountSub)
    );

    await expect(tool({}, ctx)).resolves.toBe("tool-user");
    expect(resolver).toHaveBeenCalledWith({
      name: "claude-code",
      version: "1.0",
    });
  });

  it("rejects with the auth failure so McpServer reports a tool error", async () => {
    setProcessAuthResolver(() => Promise.reject(new Error("login required")));
    const tool = withToolAuth(server, async () => Promise.resolve("never"));

    await expect(tool({}, ctx)).rejects.toThrow("login required");
  });
});

describe("withAgentSession", () => {
  const session = (sessionId: string) =>
    ({ sessionId }) as unknown as NonNullable<AuthContext["runtime"]>;
  const refusal = (description: string) =>
    new CibaAuthorizationError(
      400,
      JSON.stringify({
        error: "invalid_request",
        error_description: description,
      })
    );

  it("registers a new session and sends once more when Zentity reports the session inactive", async () => {
    const renewRuntime = vi.fn().mockResolvedValue(session("session-2"));
    const send = vi
      .fn()
      .mockRejectedValueOnce(refusal(AGENT_SESSION_INACTIVE_DESCRIPTION))
      .mockResolvedValueOnce("sent");

    const result = await withAgentSession(
      { ...makeAuth("sub-1"), runtime: session("session-1"), renewRuntime },
      send
    );

    expect(result).toBe("sent");
    expect(renewRuntime).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.map(([runtime]) => runtime.sessionId)).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("keeps any other refusal, and a second inactive one, as errors", async () => {
    const renewRuntime = vi.fn().mockResolvedValue(session("session-2"));
    const auth = {
      ...makeAuth("sub-1"),
      runtime: session("session-1"),
      renewRuntime,
    };
    const mismatch = refusal("Agent-Assertion does not match this request");

    await expect(
      withAgentSession(auth, () => Promise.reject(mismatch))
    ).rejects.toBe(mismatch);
    expect(renewRuntime).not.toHaveBeenCalled();

    const inactive = refusal(AGENT_SESSION_INACTIVE_DESCRIPTION);
    await expect(
      withAgentSession(auth, () => Promise.reject(inactive))
    ).rejects.toBe(inactive);
    expect(renewRuntime).toHaveBeenCalledTimes(1);
  });
});
