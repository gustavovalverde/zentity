import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuthContext,
  getAuthContext,
  requireAuth,
  runWithAuth,
  setProcessAuthResolver,
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

  it("turns auth failures into tool errors", async () => {
    setProcessAuthResolver(() => Promise.reject(new Error("login required")));
    const tool = withToolAuth(server, async () => Promise.resolve("never"));

    await expect(tool({}, ctx)).resolves.toEqual({
      isError: true,
      content: [{ type: "text", text: "login required" }],
    });
  });
});
