import type { Session } from "@/lib/auth/auth-config";

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getAuthenticationStateBySessionId: vi.fn(),
}));

const dbMocks = vi.hoisted(() => {
  const get = vi.fn();
  const builder = {
    from: vi.fn(() => builder),
    get: vi.fn(() => get()),
    innerJoin: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    where: vi.fn(() => builder),
  };
  // A fire-and-forget better-auth adapter write (module-load warmup) reaches the
  // mocked connection; give insert a benign resolving chain so it does not
  // surface as an unhandled rejection. The register path itself never inserts.
  const insertBuilder = {
    values: vi.fn(() => insertBuilder),
    returning: vi.fn(async () => []),
    onConflictDoNothing: vi.fn(() => insertBuilder),
    onConflictDoUpdate: vi.fn(() => insertBuilder),
  };
  return {
    builder,
    get,
    insert: vi.fn(() => insertBuilder),
    select: vi.fn(() => builder),
  };
});

const privacyMocks = vi.hoisted(() => ({
  upsertCredentialBindingCommitment: vi.fn(),
}));

vi.mock("@/lib/auth/auth-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/auth-context")>();
  return {
    ...actual,
    getAuthenticationStateBySessionId: (...args: unknown[]) =>
      authMocks.getAuthenticationStateBySessionId(...args),
  };
});

vi.mock("@/lib/db/connection", () => ({
  db: {
    insert: dbMocks.insert,
    select: dbMocks.select,
  },
}));

vi.mock("@/lib/db/queries/privacy", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/queries/privacy")>();
  return {
    ...actual,
    upsertCredentialBindingCommitment: (...args: unknown[]) =>
      privacyMocks.upsertCredentialBindingCommitment(...args),
  };
});

const session = {
  user: { id: "user-123", twoFactorEnabled: true },
  session: { id: "session-123" },
} as unknown as Session;

async function createCaller() {
  const { credentialBindingsRouter } = await import(
    "@/lib/trpc/routers/credential-bindings"
  );
  return credentialBindingsRouter.createCaller({
    authContext: null,
    flowId: null,
    flowIdSource: "none",
    req: new Request("http://localhost/api/trpc"),
    requestId: "test-request-id",
    resHeaders: new Headers(),
    session,
  });
}

function validInput() {
  return {
    secretId: "secret-123",
    credentialId: "credential-123",
    credentialKind: "passkey" as const,
    credentialBindingCommitment: "0xABCD",
  };
}

describe("credentialBindings.register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getAuthenticationStateBySessionId.mockResolvedValue({
      id: "auth-context-123",
      loginMethod: "passkey",
      amr: ["pwdless"],
      authStrength: "strong",
      authenticatedAt: Math.floor(Date.now() / 1000),
      sourceKind: "better_auth",
    });
    dbMocks.get.mockResolvedValue({ secretId: "secret-123" });
    privacyMocks.upsertCredentialBindingCommitment.mockResolvedValue({
      id: "binding-123",
    });
  });

  it("registers a normalized commitment for a fresh matching credential", async () => {
    const caller = await createCaller();

    await expect(caller.register(validInput())).resolves.toEqual({
      credentialBindingId: "binding-123",
    });

    expect(dbMocks.select).toHaveBeenCalled();
    expect(privacyMocks.upsertCredentialBindingCommitment).toHaveBeenCalledWith(
      expect.objectContaining({
        authContextId: "auth-context-123",
        commitment: "0xabcd",
        credentialId: "credential-123",
        credentialKind: "passkey",
        secretId: "secret-123",
        userId: "user-123",
      })
    );
  });

  it("rejects when the fresh auth context is for a different credential kind", async () => {
    authMocks.getAuthenticationStateBySessionId.mockResolvedValue({
      id: "auth-context-123",
      loginMethod: "opaque",
      amr: ["pwd"],
      authStrength: "basic",
      authenticatedAt: Math.floor(Date.now() / 1000),
      sourceKind: "better_auth",
    });

    const caller = await createCaller();

    await expect(caller.register(validInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Fresh credential confirmation is required.",
    });
    expect(
      privacyMocks.upsertCredentialBindingCommitment
    ).not.toHaveBeenCalled();
  });

  it("rejects stale credential confirmations", async () => {
    authMocks.getAuthenticationStateBySessionId.mockResolvedValue({
      id: "auth-context-123",
      loginMethod: "passkey",
      amr: ["pwdless"],
      authStrength: "strong",
      authenticatedAt: Math.floor((Date.now() - 10 * 60 * 1000) / 1000),
      sourceKind: "better_auth",
    });

    const caller = await createCaller();

    await expect(caller.register(validInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Credential confirmation expired. Please try again.",
    });
    expect(
      privacyMocks.upsertCredentialBindingCommitment
    ).not.toHaveBeenCalled();
  });

  it("rejects commitments without a matching FHE wrapper", async () => {
    dbMocks.get.mockResolvedValue(null);

    const caller = await createCaller();

    await expect(caller.register(validInput())).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Credential binding must match an enrolled FHE key wrapper.",
    });
    expect(
      privacyMocks.upsertCredentialBindingCommitment
    ).not.toHaveBeenCalled();
  });
});
