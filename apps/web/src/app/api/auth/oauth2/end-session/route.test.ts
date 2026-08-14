import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  handler: vi.fn(),
}));

vi.mock("@/lib/auth/auth-config", () => ({
  auth: { handler: authMocks.handler },
}));

import { GET, POST } from "./route";

describe("RP-Initiated Logout route", () => {
  beforeEach(() => {
    authMocks.handler.mockReset();
  });

  it.each([
    ["GET", GET],
    ["POST", POST],
  ] as const)("delegates %s requests to the OAuth provider", async (method, route) => {
    const request = new Request(
      "http://localhost:3000/api/auth/oauth2/end-session",
      { method }
    );
    const expected = new Response(null, { status: 204 });
    authMocks.handler.mockResolvedValueOnce(expected);

    await expect(route(request)).resolves.toBe(expected);
    expect(authMocks.handler).toHaveBeenCalledWith(request);
  });
});
