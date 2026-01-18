import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({
  requireSession: authMocks.requireSession,
}));

const contextMocks = vi.hoisted(() => ({
  createFheEnrollmentContext: vi.fn(),
}));

vi.mock("@/lib/auth/fhe-enrollment-tokens", () => contextMocks);

import { POST } from "../route";

describe("FHE enrollment context route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      }),
    });

    const response = await POST(
      new Request("http://localhost/api/fhe-enrollment/context", {
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("creates FHE enrollment context for authenticated user", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-123" } },
    });
    contextMocks.createFheEnrollmentContext.mockResolvedValue({
      contextToken: "ctx-token",
      registrationToken: "reg-token",
      expiresAt: "2025-01-01T00:00:00Z",
    });

    const response = await POST(
      new Request("http://localhost/api/fhe-enrollment/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "  test@example.com " }),
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      contextToken: "ctx-token",
      registrationToken: "reg-token",
      expiresAt: "2025-01-01T00:00:00Z",
    });
    expect(contextMocks.createFheEnrollmentContext).toHaveBeenCalledWith({
      userId: "user-123",
      email: "test@example.com",
    });
  });
});
