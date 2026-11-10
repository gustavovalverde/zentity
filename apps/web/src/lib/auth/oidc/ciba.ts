import "server-only";

import type {
  AapAccessTokenClaims,
  AuthenticationState,
} from "@zentity/sdk/protocol";
import type { BetterAuthPlugin } from "better-auth";
import type { StoredTokenSnapshot } from "@/lib/agents/token-snapshot";

import { defineRequestState } from "@better-auth/core/context";
import {
  APIError,
  createAuthEndpoint,
  sensitiveSessionMiddleware,
  sessionMiddleware,
} from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { resolveCibaApprovalData } from "@/lib/agents/approval-resolve";
import { computeAcr } from "@/lib/assurance/oidc-claims";
import { getAccountAssurance } from "@/lib/assurance/posture";
import { getAuthenticationStateBySessionId } from "@/lib/auth/auth-context";
import { findSatisfiedAcr } from "@/lib/auth/oidc/step-up";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";

/**
 * Zentity's side of OpenID CIBA on top of `@better-auth/ciba`: the parameters
 * the plugin does not model, the approval decision (step-up, then
 * `completeCibaRequest`), and the per-request stash the token grant reads.
 *
 * Users decide on Zentity's own `/approve/{requestId}` page or from a push
 * notification, through `/ciba/decision`, never on the provider's consent
 * page, so every approval runs the assurance check below before the plugin
 * records it.
 */

// ── bc-authorize parameters the plugin does not model ────────────────

interface BackchannelExtras {
  acrValues: string | null;
  authorizationDetails: string | null;
}

// `@better-auth/ciba` validates its own body schema, which drops RFC 9396
// `authorization_details` and `acr_values`. The bc-authorize before-hook
// captures them here; `sendNotification`, which runs later in the same request
// with the new request id, persists them.
const backchannelExtrasState = defineRequestState<BackchannelExtras | null>(
  () => null
);

function readAuthorizationDetails(value: unknown): string | null {
  if (value === undefined || value === "") {
    return null;
  }
  if (typeof value === "string") {
    try {
      JSON.parse(value);
    } catch {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_request",
        error_description: "authorization_details must be valid JSON",
      });
    }
    return value;
  }
  return JSON.stringify(value);
}

/** The stored RAR as issued in the token, or null when absent or corrupt. */
export function parseStoredAuthorizationDetails(
  raw: string | null
): unknown[] | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function captureBackchannelExtras(
  body: Record<string, unknown>
): Promise<void> {
  const acrValues =
    typeof body.acr_values === "string" && body.acr_values.trim()
      ? body.acr_values.trim()
      : null;
  await backchannelExtrasState.set({
    acrValues,
    authorizationDetails: readAuthorizationDetails(body.authorization_details),
  });
}

export async function persistBackchannelExtras(
  requestId: string
): Promise<BackchannelExtras> {
  const extras = (await backchannelExtrasState.get()) ?? {
    acrValues: null,
    authorizationDetails: null,
  };
  if (extras.acrValues || extras.authorizationDetails) {
    await db
      .update(cibaRequests)
      .set(extras)
      .where(eq(cibaRequests.id, requestId))
      .run();
  }
  return extras;
}

// ── Token grant stash ────────────────────────────────────────────────

/**
 * What the `/oauth2/token` CIBA grant needs from the request row, read in the
 * before-hook because the plugin consumes (deletes) the row before claims
 * are built.
 */
export interface PendingCibaToken {
  /** Agent AAP claims for a verified agent session, embedded in the JWT. */
  agentClaims: AapAccessTokenClaims | null;
  /** Approval-time authentication context, "" when none was captured. */
  authContextId: string;
  /**
   * RFC 9396 authorization details issued in the access token and the token
   * response: the canonical payment authorization when the request carries
   * one, otherwise the stored request's RAR.
   */
  authorizationDetails: unknown[] | null;
  /** The stored `auth_req_id` hash, which every CIBA token references. */
  authReqIdHash: string;
  /** Durable agent snapshot, set only for verified agent sessions. */
  snapshot: StoredTokenSnapshot | null;
}

const pendingCibaTokenState = defineRequestState<PendingCibaToken | null>(
  () => null
);

export function setPendingCibaToken(pending: PendingCibaToken): Promise<void> {
  return pendingCibaTokenState.set(pending);
}

export function getPendingCibaToken(): Promise<PendingCibaToken | null> {
  return pendingCibaTokenState.get();
}

// ── Approval decision ────────────────────────────────────────────────

/** How an approval was obtained, recorded on the request for oversight. */
type CibaApprovalGrant =
  | { method: "user" }
  | {
      capabilityName: string;
      constraints: string | null;
      grantId: string | null;
      hostPolicyId: string | null;
      method: "capability_grant";
      strength: string | null;
    };

interface CibaDecisionInput {
  /** The authentication that approves the request, issued as amr/auth_time. */
  authentication: AuthenticationState;
  grant: CibaApprovalGrant;
  requestId: string;
  userId: string;
}

function cibaDecisionError(
  status: "BAD_REQUEST" | "FORBIDDEN",
  error: string,
  description: string
): APIError {
  return new APIError(status, { error, error_description: description });
}

interface CompleteCibaRequestBody {
  acr?: string;
  amr?: string[];
  authTime?: Date;
  decision: "approved" | "denied";
  requestId: string;
  userId: string;
}

/** Records a decision through the CIBA plugin's `completeCibaRequest`. */
export type CompleteCibaRequest = (
  body: CompleteCibaRequestBody
) => Promise<unknown>;

export interface CibaApproval {
  /**
   * Approves a pending request for its hinted user. The user's assurance tier
   * must satisfy any `acr_values` the client sent, and is issued as the ID
   * token `acr`. Zentity's approval metadata, and the request's own hash as
   * the token `referenceId` that keys release contexts and agent snapshots,
   * are written while the request is still pending, so a token poll can never
   * claim it without them.
   */
  approve: (input: CibaDecisionInput) => Promise<void>;
  /** Denies a pending request for its hinted user. */
  deny: (input: { requestId: string; userId: string }) => Promise<void>;
}

export function createCibaApproval(
  completeCibaRequest: CompleteCibaRequest
): CibaApproval {
  return {
    async approve(input) {
      const row = await db
        .select({
          acrValues: cibaRequests.acrValues,
          authReqId: cibaRequests.authReqId,
          expiresAt: cibaRequests.expiresAt,
          status: cibaRequests.status,
          userId: cibaRequests.userId,
        })
        .from(cibaRequests)
        .where(eq(cibaRequests.id, input.requestId))
        .limit(1)
        .get();
      if (
        !row ||
        row.userId !== input.userId ||
        row.status !== "pending" ||
        row.expiresAt <= new Date()
      ) {
        throw cibaDecisionError(
          "BAD_REQUEST",
          "invalid_request",
          "This request is invalid, has expired, or was sent to another account"
        );
      }

      const { authentication, grant } = input;
      const assurance = await getAccountAssurance(input.userId, {
        isAuthenticated: true,
      });
      if (row.acrValues && !findSatisfiedAcr(row.acrValues, assurance.tier)) {
        throw cibaDecisionError(
          "FORBIDDEN",
          "insufficient_user_authentication",
          `Your assurance level (tier-${assurance.tier}) does not meet the required level: ${row.acrValues}`
        );
      }

      await db
        .update(cibaRequests)
        .set({
          referenceId: row.authReqId,
          authContextId: authentication.id,
          approvalMethod: grant.method,
          ...(grant.method === "capability_grant"
            ? {
                approvedCapabilityName: grant.capabilityName,
                approvedConstraints: grant.constraints,
                approvedGrantId: grant.grantId,
                approvedHostPolicyId: grant.hostPolicyId,
                approvalStrength: grant.strength,
              }
            : {}),
        })
        .where(
          and(
            eq(cibaRequests.id, input.requestId),
            eq(cibaRequests.status, "pending")
          )
        )
        .run();

      await completeCibaRequest({
        requestId: input.requestId,
        userId: input.userId,
        decision: "approved",
        acr: computeAcr(assurance.tier),
        ...(authentication.amr.length > 0 ? { amr: authentication.amr } : {}),
        authTime: new Date(authentication.authenticatedAt * 1000),
      });
    },
    async deny(input) {
      await completeCibaRequest({
        requestId: input.requestId,
        userId: input.userId,
        decision: "denied",
      });
    },
  };
}

/** The page a notification links to; it loads the request by id. */
export function cibaApprovalUrl(appUrl: string, requestId: string): string {
  return `${appUrl}/approve/${encodeURIComponent(requestId)}`;
}

// ── Approval endpoints ───────────────────────────────────────────────

function unknownCibaRequest(): APIError {
  return new APIError("NOT_FOUND", {
    error: "invalid_request",
    error_description: "Unknown request",
  });
}

/**
 * The endpoints Zentity's approval page and push notifications call. They
 * run inside Better Auth, so they share its session handling and the
 * origin check that keeps another site from deciding with the user's cookie.
 */
export function cibaApprovalPlugin(approval: CibaApproval) {
  return {
    id: "zentity-ciba-approval",
    endpoints: {
      getCibaApprovalRequest: createAuthEndpoint(
        "/ciba/request",
        {
          method: "GET",
          query: z.object({ request_id: z.string().min(1) }),
          use: [sessionMiddleware],
          metadata: { noStore: true },
        },
        async (ctx) => {
          const details = await resolveCibaApprovalData(
            ctx.query.request_id,
            ctx.context.session.user.id
          );
          if (!details) {
            throw unknownCibaRequest();
          }
          return ctx.json(details.request);
        }
      ),
      decideCibaRequest: createAuthEndpoint(
        "/ciba/decision",
        {
          method: "POST",
          body: z.object({
            request_id: z.string().min(1),
            decision: z.enum(["approved", "denied"]),
          }),
          // A decision issues tokens, so a revoked session must not act from
          // the cookie cache.
          use: [sensitiveSessionMiddleware],
          metadata: { noStore: true },
        },
        async (ctx) => {
          const { session } = ctx.context;
          const userId = session.user.id;
          const requestId = ctx.body.request_id;
          const details = await resolveCibaApprovalData(requestId, userId);
          if (!details) {
            throw unknownCibaRequest();
          }
          const { status, expires_at } = details.request;
          if (status !== "pending") {
            throw new APIError("BAD_REQUEST", {
              error: "invalid_request",
              error_description: `This request was already ${status}`,
            });
          }
          if (new Date(expires_at) <= new Date()) {
            throw new APIError("BAD_REQUEST", {
              error: "expired_token",
              error_description: "This request has expired",
            });
          }

          if (ctx.body.decision === "denied") {
            await approval.deny({ requestId, userId });
            return ctx.json({ status: "denied" });
          }
          const authentication = await getAuthenticationStateBySessionId(
            session.session.id
          );
          if (!authentication) {
            throw new APIError("UNAUTHORIZED", {
              error: "login_required",
              error_description: "Sign in again to approve this request",
            });
          }
          await approval.approve({
            requestId,
            userId,
            authentication,
            grant: { method: "user" },
          });
          return ctx.json({ status: "approved" });
        }
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path: string) => path === "/ciba/decision",
        window: 60,
        max: 20,
      },
    ],
  } satisfies BetterAuthPlugin;
}
