import { NextResponse } from "next/server";

import { requireBrowserSession } from "@/lib/auth/api-auth";
import { normalizeIdentityFields } from "@/lib/auth/oidc/identity-fields-schema";
import {
  createIdentityIntentToken,
  createScopeHash,
  verifyIdentityIntentToken,
} from "@/lib/auth/oidc/identity-intent";
import {
  extractIdentityScopes,
  filterIdentityByScopes,
} from "@/lib/auth/oidc/identity-scopes";
import { rateLimitResponse } from "@/lib/utils/rate-limit";
import { oauth2IdentityLimiter } from "@/lib/utils/rate-limiters";

// ── Types ──────────────────────────────────────────────────

interface IdentityIntentInput {
  authorizedScopes: string[];
  authReqId?: string;
  clientId: string;
  scopes: string[];
}

interface IdentityStageInput {
  authorizedScopes: string[];
  authReqId?: string;
  clientId: string;
  identity: Record<string, unknown> | undefined;
  intentToken: string | undefined;
  oauthRequestKey?: string | undefined;
  scopes: string[];
}

interface ValidatedIdentityStage {
  authReqId?: string | undefined;
  clientId: string;
  filteredIdentity: Record<string, unknown>;
  identityScopes: string[];
  intentJti: string;
  oauthRequestKey?: string | undefined;
  scopeHash: string;
  scopes: string[];
  userId: string;
}

// ── Shared helpers ─────────────────────────────────────────

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function validateScopeSubset(
  submitted: string[],
  authorized: string[]
): Response | null {
  const authorizedSet = new Set(authorized);
  for (const scope of submitted) {
    if (!authorizedSet.has(scope)) {
      return jsonError(`Scope not authorized: ${scope}`, 400);
    }
  }
  return null;
}

async function resolveSessionAndBody(
  request: Request
): Promise<{ userId: string; body: unknown } | Response> {
  const authResult = await requireBrowserSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { limited, retryAfter } = oauth2IdentityLimiter.check(
    authResult.session.user.id
  );
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  return { userId: authResult.session.user.id, body };
}

// ── Intent handler ─────────────────────────────────────────

export async function handleIdentityIntent(
  request: Request,
  resolveContext: (
    body: unknown,
    userId: string
  ) => Promise<IdentityIntentInput | Response>
): Promise<Response> {
  const sessionResult = await resolveSessionAndBody(request);
  if (sessionResult instanceof Response) {
    return sessionResult;
  }
  const { userId, body } = sessionResult;

  const ctx = await resolveContext(body, userId);
  if (ctx instanceof Response) {
    return ctx;
  }

  const scopeError = validateScopeSubset(ctx.scopes, ctx.authorizedScopes);
  if (scopeError) {
    return scopeError;
  }

  if (extractIdentityScopes(ctx.scopes).length === 0) {
    return jsonError("At least one identity scope is required", 400);
  }

  const intent = await createIdentityIntentToken({
    userId,
    clientId: ctx.clientId,
    scopes: ctx.scopes,
    ...(ctx.authReqId ? { authReqId: ctx.authReqId } : {}),
  });

  return NextResponse.json({
    intent_token: intent.intentToken,
    expires_at: intent.expiresAt,
  });
}

// ── Stage handler ──────────────────────────────────────────

export async function handleIdentityStage(
  request: Request,
  resolveContext: (
    body: unknown,
    userId: string
  ) => Promise<IdentityStageInput | Response>,
  persist: (validated: ValidatedIdentityStage) => Promise<Response>
): Promise<Response> {
  const sessionResult = await resolveSessionAndBody(request);
  if (sessionResult instanceof Response) {
    return sessionResult;
  }
  const { userId, body } = sessionResult;

  const ctx = await resolveContext(body, userId);
  if (ctx instanceof Response) {
    return ctx;
  }

  const scopeError = validateScopeSubset(ctx.scopes, ctx.authorizedScopes);
  if (scopeError) {
    return scopeError;
  }

  const identityScopes = extractIdentityScopes(ctx.scopes);
  if (identityScopes.length === 0) {
    return NextResponse.json({ staged: false });
  }

  if (!ctx.intentToken) {
    return jsonError("Missing intent_token for identity scopes", 400);
  }

  let intentPayload: Awaited<ReturnType<typeof verifyIdentityIntentToken>>;
  try {
    intentPayload = await verifyIdentityIntentToken(ctx.intentToken);
  } catch {
    return jsonError("Invalid or expired intent token", 400);
  }

  if (intentPayload.userId !== userId) {
    return jsonError("Intent token does not match current user", 403);
  }

  if (ctx.authReqId && intentPayload.authReqId !== ctx.authReqId) {
    return jsonError(
      "Intent token was issued for a different auth_req_id",
      400
    );
  }

  const scopeHash = createScopeHash(ctx.scopes);
  if (
    intentPayload.clientId !== ctx.clientId ||
    intentPayload.scopeHash !== scopeHash
  ) {
    return jsonError("Intent token does not match request context", 400);
  }

  const normalizedIdentity = normalizeIdentityFields(ctx.identity ?? {});
  const filteredIdentity = filterIdentityByScopes(
    normalizedIdentity,
    identityScopes
  );

  if (Object.keys(filteredIdentity).length === 0) {
    return NextResponse.json({ staged: false });
  }

  return persist({
    userId,
    filteredIdentity,
    scopes: ctx.scopes,
    identityScopes,
    clientId: ctx.clientId,
    scopeHash,
    intentJti: intentPayload.jti,
    authReqId: ctx.authReqId,
    oauthRequestKey: ctx.oauthRequestKey,
  });
}

// ── Unstage handler ─────────────────────────────────────

export async function handleIdentityUnstage(
  request: Request,
  resolveContext: (
    body: unknown,
    userId: string
  ) => Promise<unknown | Response>,
  clear: (context: unknown) => Promise<void>
): Promise<Response> {
  const sessionResult = await resolveSessionAndBody(request);
  if (sessionResult instanceof Response) {
    return sessionResult;
  }
  const { userId, body } = sessionResult;

  const result = await resolveContext(body, userId);
  if (result instanceof Response) {
    return result;
  }

  await clear(result);
  return NextResponse.json({ cleared: true });
}
