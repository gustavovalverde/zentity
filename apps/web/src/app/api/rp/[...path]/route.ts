import { Hono } from "hono";
import { deleteCookie, setSignedCookie } from "hono/cookie";
import { handle } from "hono/vercel";
import z from "zod";
import { auth } from "@/lib/auth";
import {
  consumeRpAuthorizationCode,
  createRpAuthorizationCode,
  getIdentityProofByUserId,
  getUserAgeProof,
  getVerificationStatus,
} from "@/lib/db";
import {
  createRpFlowCookieName,
  getRpFlow,
  getRpFlowCookieSecret,
  isAllowedRedirectUri,
  RP_FLOW_TTL_SECONDS,
  serializeRpFlowCookieValue,
} from "@/lib/rp-flow";

export const runtime = "nodejs";

/**
 * Hono app mounted under `/api/rp/*`.
 *
 * These endpoints are external-facing RP (Relying Party) integrations:
 * - `/api/rp/authorize` -> starts flow, sets signed cookie, redirects to `/rp/verify`
 * - `/api/rp/complete`  -> requires auth, issues one-time code, redirects back to RP
 * - `/api/rp/exchange`  -> server-to-server code exchange for coarse verification flags
 */
const app = new Hono().basePath("/api/rp");

const authorizeQuerySchema = z.object({
  client_id: z.uuid(),
  redirect_uri: z.string().min(1),
  state: z.string().optional(),
});

app.get("/authorize", async (c) => {
  const parsed = authorizeQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const { client_id: clientId, redirect_uri: redirectUri, state } = parsed.data;

  if (!isAllowedRedirectUri(redirectUri)) {
    return c.json({ error: "redirect_uri not allowed" }, 400);
  }

  const flowId = crypto.randomUUID();
  const cookieName = createRpFlowCookieName(flowId);
  const cookieValue = serializeRpFlowCookieValue({
    clientId,
    redirectUri,
    state,
    createdAtMs: Date.now(),
  });

  await setSignedCookie(c, cookieName, cookieValue, getRpFlowCookieSecret(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: RP_FLOW_TTL_SECONDS,
    path: "/",
  });

  const origin = new URL(c.req.url).origin;
  const url = new URL(`/rp/verify?flow=${flowId}`, origin);
  return c.redirect(url.toString(), 302);
});

const completeQuerySchema = z.object({
  flow: z.uuid(),
});

app.get("/complete", async (c) => {
  const parsed = completeQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user?.id) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const flowId = parsed.data.flow;
  const flow = await getRpFlow(flowId);
  if (!flow) {
    return c.json({ error: "Flow expired" }, 400);
  }

  // Extra open-redirect defense in depth.
  if (!isAllowedRedirectUri(flow.redirectUri)) {
    return c.json({ error: "redirect_uri not allowed" }, 400);
  }

  const { code } = createRpAuthorizationCode({
    clientId: flow.clientId,
    redirectUri: flow.redirectUri,
    state: flow.state,
    userId: session.user.id,
  });

  deleteCookie(c, createRpFlowCookieName(flowId), { path: "/" });

  const origin = new URL(c.req.url).origin;
  const redirectUrl = flow.redirectUri.startsWith("/")
    ? new URL(flow.redirectUri, origin)
    : new URL(flow.redirectUri);

  redirectUrl.searchParams.set("code", code);
  if (flow.state) redirectUrl.searchParams.set("state", flow.state);

  return c.redirect(redirectUrl.toString(), 302);
});

const exchangeBodySchema = z.object({
  code: z.uuid(),
  client_id: z.uuid().optional(),
});

app.post("/exchange", async (c) => {
  const body = (await c.req.json().catch(() => null)) as unknown;
  const parsed = exchangeBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const consumed = consumeRpAuthorizationCode(parsed.data.code);
  if (!consumed) {
    return c.json({ error: "Invalid or expired code" }, 400);
  }

  if (parsed.data.client_id && parsed.data.client_id !== consumed.clientId) {
    return c.json({ error: "client_id mismatch" }, 400);
  }

  const userId = consumed.userId;
  const ageProof = getUserAgeProof(userId);
  const identityProof = getIdentityProofByUserId(userId);
  const verificationStatus = getVerificationStatus(userId);

  const checks = {
    document: identityProof?.isDocumentVerified ?? false,
    liveness: identityProof?.isLivenessPassed ?? false,
    faceMatch: identityProof?.isFaceMatched ?? false,
    ageProof: Boolean(ageProof?.isOver18),
  };

  const verified = Boolean(verificationStatus?.verified || ageProof?.isOver18);

  return c.json({
    success: true,
    verified,
    level: verificationStatus?.level ?? (verified ? "basic" : "none"),
    checks,
  });
});

export const GET = handle(app);
export const POST = handle(app);
