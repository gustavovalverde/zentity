import type { Session } from "@/lib/auth/auth";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRevokeIdentity = vi.fn();

vi.mock("@/lib/db/queries/identity", () => ({
  revokeIdentity: (...args: unknown[]) => mockRevokeIdentity(...args),
}));

function createSession(
  overrides: { role?: string; userId?: string } = {}
): Session {
  const userId = overrides.userId ?? "test-user";
  return {
    user: {
      id: userId,
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
      banned: false,
      role: overrides.role ?? "user",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      id: "test-session",
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      token: "test-token",
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    },
  } as unknown as Session;
}

async function createIdentityCaller(session: Session | null) {
  const { identityRouter } = await import("../router");
  return identityRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    session,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none" as const,
  });
}

describe("revoke procedures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("revokeVerification (admin-only)", () => {
    it("allows admin to revoke another user's identity", async () => {
      mockRevokeIdentity.mockResolvedValue({
        revoked: true,
        userId: "target-user",
      });

      const caller = await createIdentityCaller(
        createSession({ role: "admin" })
      );
      const result = await caller.revokeVerification({
        userId: "target-user",
        reason: "Policy violation",
      });

      expect(result).toEqual({ revoked: true, userId: "target-user" });
      expect(mockRevokeIdentity).toHaveBeenCalledWith(
        "target-user",
        "test@example.com",
        "Policy violation"
      );
    });

    it("rejects non-admin user with FORBIDDEN", async () => {
      const caller = await createIdentityCaller(
        createSession({ role: "user" })
      );

      await expect(
        caller.revokeVerification({
          userId: "target-user",
          reason: "Policy violation",
        })
      ).rejects.toThrow(expect.objectContaining({ code: "FORBIDDEN" }));

      expect(mockRevokeIdentity).not.toHaveBeenCalled();
    });

    it("rejects user with no role with FORBIDDEN", async () => {
      const session = createSession();
      (session.user as Record<string, unknown>).role = null;

      const caller = await createIdentityCaller(session);

      await expect(
        caller.revokeVerification({
          userId: "target-user",
          reason: "Test reason",
        })
      ).rejects.toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    });

    it("rejects unauthenticated requests", async () => {
      const caller = await createIdentityCaller(null);

      await expect(
        caller.revokeVerification({
          userId: "target-user",
          reason: "Test reason",
        })
      ).rejects.toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    });
  });

  describe("selfRevoke (any authenticated user)", () => {
    it("allows non-admin user to self-revoke", async () => {
      mockRevokeIdentity.mockResolvedValue({
        revoked: true,
        userId: "test-user",
      });

      const caller = await createIdentityCaller(
        createSession({ role: "user" })
      );
      const result = await caller.selfRevoke({ reason: "GDPR request" });

      expect(result).toEqual({ revoked: true, userId: "test-user" });
      expect(mockRevokeIdentity).toHaveBeenCalledWith(
        "test-user",
        "self",
        "GDPR request"
      );
    });

    it("rejects unauthenticated requests", async () => {
      const caller = await createIdentityCaller(null);

      await expect(
        caller.selfRevoke({ reason: "GDPR request" })
      ).rejects.toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    });
  });
});
