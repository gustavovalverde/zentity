/**
 * Shared utilities for testing tRPC routers.
 *
 * Provides helpers to create tRPC callers with mock sessions,
 * reducing boilerplate in integration and unit tests.
 */
import type { Session } from "@/lib/auth/auth";

type FlowIdSource = "header" | "cookie" | "query" | "none";

export interface MockUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  image?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MockSessionData {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Creates a mock session for testing.
 *
 * @param overrides - Optional overrides for user and session properties
 * @returns A mock session object compatible with better-auth
 */
export function createMockSession(
  overrides?: Partial<{
    user: Partial<MockUser>;
    session: Partial<MockSessionData>;
  }>
): Session {
  const userId = overrides?.user?.id ?? "test-user-id";
  const now = new Date();

  return {
    user: {
      id: userId,
      email: overrides?.user?.email ?? "test@example.com",
      emailVerified: overrides?.user?.emailVerified ?? true,
      name: overrides?.user?.name ?? "Test User",
      image: overrides?.user?.image ?? null,
      createdAt: overrides?.user?.createdAt ?? now,
      updatedAt: overrides?.user?.updatedAt ?? now,
    },
    session: {
      id: overrides?.session?.id ?? "test-session-id",
      token: overrides?.session?.token ?? "test-token",
      userId,
      expiresAt:
        overrides?.session?.expiresAt ?? new Date(Date.now() + 86_400_000),
      createdAt: overrides?.session?.createdAt ?? now,
      updatedAt: overrides?.session?.updatedAt ?? now,
    },
  } as Session;
}

/**
 * Creates a tRPC context for testing.
 *
 * @param options - Configuration options for the test context
 * @returns A tRPC context object
 */
export function createTestContext(options?: {
  session?: Session | null;
  ip?: string;
  flowId?: string | null;
  flowIdSource?: FlowIdSource;
  onboardingSessionId?: string | null;
}) {
  return {
    req: new Request("http://localhost/api/trpc", {
      headers: options?.ip ? { "x-forwarded-for": options.ip } : {},
    }),
    resHeaders: new Headers(),
    session: options?.session ?? null,
    requestId: crypto.randomUUID(),
    flowId: options?.flowId ?? null,
    flowIdSource: options?.flowIdSource ?? "none",
    onboardingSessionId: options?.onboardingSessionId ?? null,
  };
}

/**
 * Creates a tRPC caller for the app router with a mock session.
 *
 * @param session - The session to use (null for unauthenticated)
 * @param options - Additional context options
 * @returns A tRPC caller
 */
export async function createCallerWithSession(
  session: Session | null,
  options?: {
    ip?: string;
    flowId?: string | null;
    onboardingSessionId?: string | null;
  }
) {
  const { appRouter } = await import("@/lib/trpc/routers/app");
  return appRouter.createCaller(
    createTestContext({
      session,
      ip: options?.ip,
      flowId: options?.flowId,
      onboardingSessionId: options?.onboardingSessionId,
    })
  );
}

/**
 * Creates an authenticated tRPC caller with a default test user.
 *
 * @param userOverrides - Optional overrides for user properties
 * @returns A tRPC caller with an authenticated session
 */
export function createAuthenticatedCaller(userOverrides?: Partial<MockUser>) {
  const session = createMockSession({ user: userOverrides });
  return createCallerWithSession(session);
}

/**
 * Creates an unauthenticated tRPC caller.
 *
 * @returns A tRPC caller without a session
 */
export function createUnauthenticatedCaller() {
  return createCallerWithSession(null);
}
