import "server-only";

import type {
  AuthenticationSourceKind,
  AuthenticationState,
  LoginMethod,
} from "@/lib/assurance/types";
import type {
  AuthenticationContext,
  NewAuthenticationContext,
} from "@/lib/db/schema/authentication-context";

import { eq } from "drizzle-orm";

import {
  deriveAuthStrength,
  isValidLoginMethod,
} from "@/lib/assurance/compute";
import { loginMethodToAmr } from "@/lib/assurance/oidc-claims";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { authenticationContexts } from "@/lib/db/schema/authentication-context";
import { cibaRequests } from "@/lib/db/schema/ciba";

export const AUTHENTICATION_CONTEXT_CLAIM = "zentity_auth_context_id";

type AuthenticationReferenceType =
  | "session"
  | "authorization_code"
  | "ciba_request"
  | "oauth_refresh_token"
  | "oauth_access_token";

interface CreateAuthenticationContextInput {
  authenticatedAt: Date | number;
  loginMethod: LoginMethod;
  referenceId?: string | null;
  referenceType?: AuthenticationReferenceType | null;
  sourceKind: AuthenticationSourceKind;
  sourceSessionId?: string | null;
  userId: string;
}

interface CreateSessionAuthenticationContextInput {
  loginMethod: unknown;
  sessionId: string;
  sourceKind: AuthenticationSourceKind;
  userId: string;
}

function toTimestampMs(
  value: Date | number | string,
  fieldName: string
): number {
  let timestampMs: number;

  if (value instanceof Date) {
    timestampMs = value.getTime();
  } else if (typeof value === "number") {
    timestampMs = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    const numericTimestamp = Number(trimmed);
    timestampMs = Number.isFinite(numericTimestamp)
      ? numericTimestamp
      : Date.parse(trimmed);
  } else {
    throw new Error(`Unsupported ${fieldName} type: ${typeof value}`);
  }

  if (!Number.isFinite(timestampMs)) {
    throw new Error(`Invalid ${fieldName}: expected a finite timestamp`);
  }

  return timestampMs;
}

function toAuthenticationState(
  row: Pick<
    AuthenticationContext,
    | "amr"
    | "authenticatedAt"
    | "authStrength"
    | "id"
    | "loginMethod"
    | "sourceKind"
  >
): AuthenticationState {
  return {
    id: row.id,
    loginMethod: row.loginMethod as LoginMethod,
    amr: JSON.parse(row.amr) as string[],
    authStrength: row.authStrength === "strong" ? "strong" : "basic",
    authenticatedAt: Math.floor(row.authenticatedAt.getTime() / 1000),
    sourceKind: row.sourceKind as AuthenticationSourceKind,
  };
}

function assertLoginMethod(value: unknown): LoginMethod {
  if (!isValidLoginMethod(value)) {
    throw new Error(`Unsupported login method: ${String(value)}`);
  }
  return value;
}

function assertSessionLoginMethod(value: unknown): LoginMethod {
  if (value === "anonymous") {
    throw new Error("Anonymous sessions cannot create authentication contexts");
  }
  return assertLoginMethod(value);
}

export async function createAuthenticationContext(
  input: CreateAuthenticationContextInput
): Promise<AuthenticationState> {
  const loginMethod = assertLoginMethod(input.loginMethod);
  const amr = loginMethodToAmr(loginMethod);
  const authStrength = deriveAuthStrength(loginMethod);

  const [row] = await db
    .insert(authenticationContexts)
    .values({
      userId: input.userId,
      sourceKind: input.sourceKind,
      loginMethod,
      amr: JSON.stringify(amr),
      authStrength,
      authenticatedAt: new Date(
        toTimestampMs(input.authenticatedAt, "authenticatedAt")
      ),
      sourceSessionId: input.sourceSessionId ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
    } satisfies NewAuthenticationContext)
    .returning({
      id: authenticationContexts.id,
      loginMethod: authenticationContexts.loginMethod,
      amr: authenticationContexts.amr,
      authStrength: authenticationContexts.authStrength,
      authenticatedAt: authenticationContexts.authenticatedAt,
      sourceKind: authenticationContexts.sourceKind,
    });

  if (!row) {
    throw new Error("Failed to create authentication context");
  }

  return toAuthenticationState({
    ...row,
    authenticatedAt:
      row.authenticatedAt instanceof Date
        ? row.authenticatedAt
        : new Date(row.authenticatedAt),
  });
}

export function createSessionAuthenticationContext(
  input: CreateSessionAuthenticationContextInput
): Promise<AuthenticationState> {
  const loginMethod = assertSessionLoginMethod(input.loginMethod);
  return db.transaction(async (tx) => {
    const session = await tx
      .select({
        id: sessions.id,
        userId: sessions.userId,
        createdAt: sessions.createdAt,
        authContextId: sessions.authContextId,
      })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1)
      .get();

    if (!session) {
      throw new Error(
        `Cannot create authentication context: session ${input.sessionId} was not found`
      );
    }

    if (session.userId !== input.userId) {
      throw new Error(
        `Cannot create authentication context: session ${input.sessionId} belongs to a different user`
      );
    }

    if (session.authContextId) {
      const existing = await tx
        .select({
          id: authenticationContexts.id,
          loginMethod: authenticationContexts.loginMethod,
          amr: authenticationContexts.amr,
          authStrength: authenticationContexts.authStrength,
          authenticatedAt: authenticationContexts.authenticatedAt,
          sourceKind: authenticationContexts.sourceKind,
        })
        .from(authenticationContexts)
        .where(eq(authenticationContexts.id, session.authContextId))
        .limit(1)
        .get();

      if (existing) {
        return toAuthenticationState({
          ...existing,
          authenticatedAt:
            existing.authenticatedAt instanceof Date
              ? existing.authenticatedAt
              : new Date(existing.authenticatedAt),
        });
      }

      throw new Error(
        `Cannot create authentication context: session ${input.sessionId} references missing context ${session.authContextId}`
      );
    }

    const amr = loginMethodToAmr(loginMethod);
    const authStrength = deriveAuthStrength(loginMethod);
    const [row] = await tx
      .insert(authenticationContexts)
      .values({
        userId: input.userId,
        sourceKind: input.sourceKind,
        loginMethod,
        amr: JSON.stringify(amr),
        authStrength,
        authenticatedAt: new Date(
          toTimestampMs(
            session.createdAt,
            `session ${input.sessionId} createdAt`
          )
        ),
        sourceSessionId: input.sessionId,
        referenceType: "session",
        referenceId: input.sessionId,
      } satisfies NewAuthenticationContext)
      .returning({
        id: authenticationContexts.id,
        loginMethod: authenticationContexts.loginMethod,
        amr: authenticationContexts.amr,
        authStrength: authenticationContexts.authStrength,
        authenticatedAt: authenticationContexts.authenticatedAt,
        sourceKind: authenticationContexts.sourceKind,
      });

    if (!row) {
      throw new Error("Failed to create authentication context");
    }

    await tx
      .update(sessions)
      .set({ authContextId: row.id })
      .where(eq(sessions.id, input.sessionId))
      .run();

    return toAuthenticationState({
      ...row,
      authenticatedAt:
        row.authenticatedAt instanceof Date
          ? row.authenticatedAt
          : new Date(row.authenticatedAt),
    });
  });
}

async function getAuthenticationStateById(
  authContextId: string | null | undefined
): Promise<AuthenticationState | null> {
  if (!authContextId) {
    return null;
  }

  const row = await db
    .select({
      id: authenticationContexts.id,
      loginMethod: authenticationContexts.loginMethod,
      amr: authenticationContexts.amr,
      authStrength: authenticationContexts.authStrength,
      authenticatedAt: authenticationContexts.authenticatedAt,
      sourceKind: authenticationContexts.sourceKind,
    })
    .from(authenticationContexts)
    .where(eq(authenticationContexts.id, authContextId))
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  return toAuthenticationState({
    ...row,
    authenticatedAt:
      row.authenticatedAt instanceof Date
        ? row.authenticatedAt
        : new Date(row.authenticatedAt),
  });
}

export async function getAuthenticationStateBySessionId(
  sessionId: string | null | undefined
): Promise<AuthenticationState | null> {
  if (!sessionId) {
    return null;
  }

  const session = await db
    .select({ authContextId: sessions.authContextId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)
    .get();

  return getAuthenticationStateById(session?.authContextId ?? null);
}

async function getAuthenticationStateByCibaAuthReqId(
  authReqId: string | null | undefined
): Promise<AuthenticationState | null> {
  if (!authReqId) {
    return null;
  }

  const row = await db
    .select({ authContextId: cibaRequests.authContextId })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, authReqId))
    .limit(1)
    .get();

  return getAuthenticationStateById(row?.authContextId ?? null);
}

export function resolveAuthenticationContext(input: {
  authContextId?: string | null | undefined;
  cibaAuthReqId?: string | null | undefined;
  sessionId?: string | null | undefined;
}): Promise<AuthenticationState | null> {
  if (input.authContextId) {
    return getAuthenticationStateById(input.authContextId);
  }
  if (input.sessionId) {
    return getAuthenticationStateBySessionId(input.sessionId);
  }
  if (input.cibaAuthReqId) {
    return getAuthenticationStateByCibaAuthReqId(input.cibaAuthReqId);
  }
  return Promise.resolve(null);
}
