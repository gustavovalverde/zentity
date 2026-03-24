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

function toTimestampMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
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
      authenticatedAt: new Date(toTimestampMs(input.authenticatedAt)),
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
