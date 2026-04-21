import type { Session } from "@/lib/auth/auth-config";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRevokeAccountIdentity = vi.fn();
const mockGetAccountIdentity = vi.fn();
const mockGetVerificationReadModel = vi.fn();
const mockGetIdentityValidityOverview = vi.fn();

vi.mock("@/lib/db/queries/identity", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/queries/identity")>();
  return {
    ...actual,
    revokeIdentity: (...args: unknown[]) => mockRevokeAccountIdentity(...args),
    getAccountIdentity: (...args: unknown[]) => mockGetAccountIdentity(...args),
  };
});

vi.mock("@/lib/identity/validity/read-model", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/identity/validity/read-model")>();
  return {
    ...actual,
    getIdentityValidityOverview: (...args: unknown[]) =>
      mockGetIdentityValidityOverview(...args),
  };
});

vi.mock("@/lib/identity/verification/read-model", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/identity/verification/read-model")
    >();
  return {
    ...actual,
    getVerificationReadModel: (...args: unknown[]) =>
      mockGetVerificationReadModel(...args),
  };
});

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
  const { identityRouter } = await import("../identity");
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
    mockGetAccountIdentity.mockResolvedValue({
      bundle: {
        validityStatus: "verified",
        effectiveVerificationId: "ver-1",
        walletAddress: null,
        policyVersion: "policy-v1",
        issuerId: "issuer-1",
        attestationExpiresAt: null,
        fheKeyId: null,
        fheStatus: null,
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
        updatedAt: "2026-04-20T12:00:00.000Z",
      },
      effectiveVerification: {
        id: "ver-1",
        method: "ocr",
        status: "verified",
        verifiedAt: "2026-04-20T12:00:00.000Z",
        issuerCountry: "PT",
        documentType: "passport",
      },
      groupedCredentials: [],
    });
    mockGetVerificationReadModel.mockResolvedValue({
      verificationId: "ver-1",
      method: "ocr",
      verifiedAt: "2026-04-20T12:00:00.000Z",
      compliance: {
        level: "full",
        verified: true,
      },
      groupedIdentity: {
        effectiveVerificationId: "ver-1",
        credentials: [
          {
            credentialId: "ver-1",
            method: "ocr",
            status: "verified",
            verifiedAt: "2026-04-20T12:00:00.000Z",
            isEffective: true,
          },
        ],
      },
    });
    mockGetIdentityValidityOverview.mockResolvedValue({
      snapshot: {
        validityStatus: "verified",
        verificationExpiresAt: null,
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
      },
      latestEvent: {
        verificationId: "ver-1",
        eventKind: "revoked",
        validityStatus: "revoked",
        source: "admin",
        triggeredBy: "operator@example.com",
        reason: "Policy violation",
        createdAt: "2026-04-20T12:10:00.000Z",
      },
      latestEventDeliveries: [
        {
          target: "backchannel_logout",
          targetKey: "rp-client-1",
          status: "retrying",
          attemptCount: 1,
          lastAttemptedAt: "2026-04-20T12:10:05.000Z",
          deliveredAt: null,
          lastError: "HTTP 500",
        },
      ],
      deliverySummary: {
        pending: 0,
        delivered: 0,
        retrying: 1,
        dead_letter: 0,
      },
    });
  });

  describe("revokeVerification (admin-only)", () => {
    it("allows admin to revoke another user's identity", async () => {
      mockRevokeAccountIdentity.mockResolvedValue({
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
      expect(mockRevokeAccountIdentity).toHaveBeenCalledWith(
        "target-user",
        "test@example.com",
        "Policy violation",
        "admin"
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

      expect(mockRevokeAccountIdentity).not.toHaveBeenCalled();
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
      mockRevokeAccountIdentity.mockResolvedValue({
        revoked: true,
        userId: "test-user",
      });

      const caller = await createIdentityCaller(
        createSession({ role: "user" })
      );
      const result = await caller.selfRevoke({ reason: "GDPR request" });

      expect(result).toEqual({ revoked: true, userId: "test-user" });
      expect(mockRevokeAccountIdentity).toHaveBeenCalledWith(
        "test-user",
        "self",
        "GDPR request",
        "product"
      );
    });

    it("rejects unauthenticated requests", async () => {
      const caller = await createIdentityCaller(null);

      await expect(
        caller.selfRevoke({ reason: "GDPR request" })
      ).rejects.toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    });
  });

  describe("getOverview (admin-only)", () => {
    it("returns grouped identity, bundle state, and latest validity event for admins", async () => {
      const caller = await createIdentityCaller(
        createSession({ role: "admin" })
      );

      const result = await caller.getOverview({ userId: "target-user" });

      expect(result).toEqual({
        userId: "target-user",
        bundle: {
          validityStatus: "verified",
          effectiveVerificationId: "ver-1",
          walletAddress: null,
          policyVersion: "policy-v1",
          issuerId: "issuer-1",
          attestationExpiresAt: null,
          fheKeyId: null,
          fheStatus: null,
          revokedAt: null,
          revokedBy: null,
          revokedReason: null,
          updatedAt: "2026-04-20T12:00:00.000Z",
        },
        groupedIdentity: {
          effectiveVerificationId: "ver-1",
          credentials: [
            {
              credentialId: "ver-1",
              method: "ocr",
              status: "verified",
              verifiedAt: "2026-04-20T12:00:00.000Z",
              isEffective: true,
            },
          ],
        },
        effectiveVerification: {
          id: "ver-1",
          method: "ocr",
          status: "verified",
          verifiedAt: "2026-04-20T12:00:00.000Z",
          issuerCountry: "PT",
          documentType: "passport",
        },
        verification: {
          verificationId: "ver-1",
          method: "ocr",
          verifiedAt: "2026-04-20T12:00:00.000Z",
          level: "full",
          checked: true,
        },
        latestValidityEvent: {
          verificationId: "ver-1",
          eventKind: "revoked",
          validityStatus: "revoked",
          source: "admin",
          triggeredBy: "operator@example.com",
          reason: "Policy violation",
          createdAt: "2026-04-20T12:10:00.000Z",
        },
        latestValidityDeliveries: [
          {
            target: "backchannel_logout",
            targetKey: "rp-client-1",
            status: "retrying",
            attemptCount: 1,
            lastAttemptedAt: "2026-04-20T12:10:05.000Z",
            deliveredAt: null,
            lastError: "HTTP 500",
          },
        ],
        validityDeliverySummary: {
          pending: 0,
          delivered: 0,
          retrying: 1,
          dead_letter: 0,
        },
      });
      expect(mockGetAccountIdentity).toHaveBeenCalledWith("target-user");
      expect(mockGetVerificationReadModel).toHaveBeenCalledWith("target-user");
      expect(mockGetIdentityValidityOverview).toHaveBeenCalledWith(
        "target-user"
      );
    });

    it("rejects non-admin user with FORBIDDEN", async () => {
      const caller = await createIdentityCaller(
        createSession({ role: "user" })
      );

      await expect(
        caller.getOverview({ userId: "target-user" })
      ).rejects.toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    });
  });
});
