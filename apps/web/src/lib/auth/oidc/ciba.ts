import "server-only";

import type { AuthContext } from "@better-auth/core";
import type {
  OAuthActorClaim,
  OAuthTokenIssueParams,
} from "@better-auth/oauth-provider";
import type {
  AapAccessTokenClaims,
  AccountAssurance,
  AuthenticationState,
} from "@zentity/sdk/protocol";
import type { BetterAuthPlugin } from "better-auth";
import type { GrantConstraint } from "@/lib/agents/approval-evaluate";
import type { StoredTokenSnapshot } from "@/lib/agents/token-snapshot";

import { CIBA_GRANT_TYPE } from "@better-auth/ciba";
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
import { approvalPolicy, requiredCeremony } from "@/lib/agents/capability";
import { computeAcr, loginMethodToAmr } from "@/lib/assurance/oidc-claims";
import { getAccountAssurance } from "@/lib/assurance/posture";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createAuthenticationContext,
  getAuthenticationStateBySessionId,
} from "@/lib/auth/auth-context";
import {
  loadReleaseContext,
  releaseIdFor,
} from "@/lib/auth/oidc/disclosure/context";
import { oauthProviderOptions } from "@/lib/auth/oidc/oauth-provider";
import { findSatisfiedAcr } from "@/lib/auth/oidc/step-up";
import {
  hasPasskey,
  issuePasskeyStepUp,
  PasskeyStepUpError,
  verifyPasskeyStepUp,
} from "@/lib/auth/passkey/step-up";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import {
  type CibaApprovalChannel,
  type CibaApprovalMethod,
  cibaApprovals,
  cibaRequests,
  type NewCibaApproval,
} from "@/lib/db/schema/ciba";

/**
 * Zentity's side of OpenID CIBA on top of `@better-auth/ciba`: the approval
 * decision (strict `acr_values` step-up, then `completeCibaRequest`), the
 * per-request stash the token grant reads, and the actor the grant's tokens
 * name. The plugin itself validates, stores, and issues the request's
 * `acr_values` and RFC 9396 `authorization_details`.
 *
 * Users decide on Zentity's own `/approve/{requestId}` page or from a push
 * notification, through `/ciba/decision`, never on the provider's consent
 * page, so every approval runs the assurance check below before the plugin
 * records it.
 */

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
  /** The stored `auth_req_id` hash, which every CIBA token references. */
  authReqIdHash: string;
  /** How the approval happened, from `ciba_approval`, for the token response. */
  oversight: CibaOversight | null;
  /** Durable agent snapshot, set only for verified agent sessions. */
  snapshot: StoredTokenSnapshot | null;
}

/** The token response member that tells the client how the user approved. */
interface CibaOversight {
  approved_at: number;
  method: CibaApprovalMethod;
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

// ── Token grant actor and authentication ─────────────────────────────

async function pendingCibaTokenFor(
  params: OAuthTokenIssueParams
): Promise<PendingCibaToken | null> {
  const pending = await getPendingCibaToken();
  return pending && pending.authReqIdHash === params.referenceId
    ? pending
    : null;
}

/**
 * The RFC 8693 actor a CIBA token names: the verified agent session behind
 * the request, otherwise the client, which acts for the user.
 */
function resolveCibaActor(
  params: OAuthTokenIssueParams,
  pending: PendingCibaToken | null
): OAuthActorClaim {
  const agentActor = pending?.agentClaims?.act;
  return agentActor
    ? { ...agentActor }
    : { sub: params.client.clientId, sub_profile: "service" };
}

/**
 * Better Auth owns a token's `act` and stamps only the one a grant passes to
 * `issueTokens`, which the `@better-auth/ciba` grant does not do, so the CIBA
 * grant issues through a provider that adds it, along with the approval's
 * authentication context and the `oversight` token response member. The
 * authentication context goes in the token's claims, which the provider
 * stores on an opaque token, because the token has no session to resolve it
 * from. Like any delegated issuance, a CIBA token then comes without a
 * refresh token, because a refreshed token would no longer name the actor.
 */
function issueCibaTokensWithActor(context: AuthContext): void {
  const grants = oauthProviderOptions(context).extensions?.find(
    (extension) => extension.grants?.[CIBA_GRANT_TYPE]
  )?.grants;
  const grant = grants?.[CIBA_GRANT_TYPE];
  if (!(grants && grant)) {
    throw new Error("zentity-ciba-approval must be registered after ciba()");
  }
  grants[CIBA_GRANT_TYPE] = (input) =>
    grant({
      ...input,
      provider: {
        ...input.provider,
        issueTokens: async (params) => {
          const pending = await pendingCibaTokenFor(params);
          return input.provider.issueTokens({
            ...params,
            act: resolveCibaActor(params, pending),
            ...(pending?.authContextId
              ? {
                  accessTokenClaims: {
                    ...params.accessTokenClaims,
                    [AUTHENTICATION_CONTEXT_CLAIM]: pending.authContextId,
                  },
                }
              : {}),
            ...(pending?.oversight
              ? {
                  tokenResponse: {
                    ...params.tokenResponse,
                    oversight: pending.oversight,
                  },
                }
              : {}),
          });
        },
      },
    });
}

// ── Approval decision ────────────────────────────────────────────────

/** How an approval was obtained, recorded in `ciba_approval`. */
type CibaApprovalGrant =
  | { method: "session" | "user_verification" }
  | {
      capabilityName: string;
      constraints: GrantConstraint[] | null;
      grantId: string | null;
      hostPolicyId: string | null;
      method: "capability_grant";
    };

interface CibaDecisionInput {
  /** The authentication that approves the request, issued as amr/auth_time. */
  authentication: AuthenticationState;
  channel: CibaApprovalChannel;
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
   * token `acr`. The `ciba_approval` record, and the request's own hash as
   * the token `referenceId` that keys release contexts, agent snapshots, and
   * the record, are written while the request is still pending, so a token
   * poll can never claim it without them.
   */
  approve: (input: CibaDecisionInput) => Promise<void>;
  /** Denies a pending request for its hinted user. */
  deny: (input: {
    channel: CibaApprovalChannel;
    requestId: string;
    userId: string;
  }) => Promise<void>;
}

/**
 * Refuses an approval when the user's tier does not satisfy the request's
 * `acr_values`, and returns the user's assurance for the ID token `acr`.
 */
async function assertAcrSatisfied(
  userId: string,
  storedAcrValues: string | null
): Promise<AccountAssurance> {
  const assurance = await getAccountAssurance(userId, {
    isAuthenticated: true,
  });
  const acrValues = parseStoredStringArray(storedAcrValues);
  if (acrValues.length > 0 && !findSatisfiedAcr(acrValues, assurance.tier)) {
    throw cibaDecisionError(
      "FORBIDDEN",
      "insufficient_user_authentication",
      `Your assurance level (tier-${assurance.tier}) does not meet the required level: ${acrValues.join(" ")}`
    );
  }
  return assurance;
}

async function loadPendingRequest(requestId: string, userId: string) {
  const row = await db
    .select({
      acrValues: cibaRequests.acrValues,
      agentSessionId: cibaRequests.agentSessionId,
      assertionVerified: cibaRequests.assertionVerified,
      attestationProvider: cibaRequests.attestationProvider,
      attestationTier: cibaRequests.attestationTier,
      authorizationDetails: cibaRequests.authorizationDetails,
      authReqId: cibaRequests.authReqId,
      bindingMessage: cibaRequests.bindingMessage,
      clientId: cibaRequests.clientId,
      createdAt: cibaRequests.createdAt,
      expiresAt: cibaRequests.expiresAt,
      hostId: cibaRequests.hostId,
      scope: cibaRequests.scope,
      status: cibaRequests.status,
      userId: cibaRequests.userId,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.id, requestId))
    .limit(1)
    .get();
  if (
    !row ||
    row.userId !== userId ||
    row.status !== "pending" ||
    row.expiresAt <= new Date()
  ) {
    throw cibaDecisionError(
      "BAD_REQUEST",
      "invalid_request",
      "This request is invalid, has expired, or was sent to another account"
    );
  }
  return row;
}

type PendingCibaRequest = Awaited<ReturnType<typeof loadPendingRequest>>;

/**
 * Inserts the decision record. The unique `reference_id` lets only one
 * decision win; a loser learns which decision came first.
 */
async function insertDecisionRecord(
  row: PendingCibaRequest,
  record: Omit<
    NewCibaApproval,
    | "acrValues"
    | "agentSessionId"
    | "attestationProvider"
    | "attestationTier"
    | "authorizationDetails"
    | "bindingMessage"
    | "clientId"
    | "decidedAt"
    | "expiresAt"
    | "hostId"
    | "referenceId"
    | "requestedAt"
    | "scope"
    | "userId"
  >
): Promise<string> {
  const verifiedAgent = row.assertionVerified === true;
  const [inserted] = await db
    .insert(cibaApprovals)
    .values({
      ...record,
      referenceId: row.authReqId,
      userId: row.userId,
      clientId: row.clientId,
      scope: row.scope,
      bindingMessage: row.bindingMessage,
      authorizationDetails: row.authorizationDetails,
      acrValues: row.acrValues,
      agentSessionId: verifiedAgent ? row.agentSessionId : null,
      hostId: verifiedAgent ? row.hostId : null,
      attestationTier: verifiedAgent ? row.attestationTier : null,
      attestationProvider: verifiedAgent ? row.attestationProvider : null,
      requestedAt: row.createdAt,
      decidedAt: new Date(),
      expiresAt: row.expiresAt,
    })
    .onConflictDoNothing({ target: cibaApprovals.referenceId })
    .returning({ id: cibaApprovals.id });
  if (inserted) {
    return inserted.id;
  }
  const winner = await db
    .select({ decision: cibaApprovals.decision })
    .from(cibaApprovals)
    .where(eq(cibaApprovals.referenceId, row.authReqId))
    .limit(1)
    .get();
  throw cibaDecisionError(
    "BAD_REQUEST",
    "invalid_request",
    `This request was already ${winner?.decision ?? "approved"}`
  );
}

/** Completes the request, or removes the record so a retry can decide. */
async function completeOrRollback(
  recordId: string,
  complete: () => Promise<unknown>
): Promise<void> {
  try {
    await complete();
  } catch (error) {
    await db.delete(cibaApprovals).where(eq(cibaApprovals.id, recordId)).run();
    throw error;
  }
}

export function createCibaApproval(
  completeCibaRequest: CompleteCibaRequest
): CibaApproval {
  return {
    async approve(input) {
      const row = await loadPendingRequest(input.requestId, input.userId);

      const { authentication, grant } = input;
      const assurance = await assertAcrSatisfied(input.userId, row.acrValues);

      const recordId = await insertDecisionRecord(row, {
        requestId: input.requestId,
        decision: "approved",
        approvalMethod: grant.method,
        approvalChannel: input.channel,
        authContextId: authentication.id,
        ...(grant.method === "capability_grant"
          ? {
              capability: grant.capabilityName,
              constraints: grant.constraints,
              grantId: grant.grantId,
              hostPolicyId: grant.hostPolicyId,
            }
          : {}),
      });

      await completeOrRollback(recordId, async () => {
        await db
          .update(cibaRequests)
          .set({
            referenceId: row.authReqId,
            authContextId: authentication.id,
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
      });
    },
    async deny(input) {
      const row = await loadPendingRequest(input.requestId, input.userId);
      const recordId = await insertDecisionRecord(row, {
        requestId: input.requestId,
        decision: "denied",
        approvalChannel: input.channel,
      });
      await completeOrRollback(recordId, () =>
        completeCibaRequest({
          requestId: input.requestId,
          userId: input.userId,
          decision: "denied",
        })
      );
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

function passkeyRequired(): APIError {
  return new APIError("CONFLICT", {
    error: "passkey_required",
    error_description: "Add a passkey to approve this request",
  });
}

const webauthnAssertionSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  response: z.object({
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1),
    signature: z.string().min(1),
    userHandle: z.string().optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Loads a request the session user may decide: theirs, pending, and
 * unexpired. Both decision endpoints answer these refusals the same way.
 */
async function loadDecidableRequest(requestId: string, userId: string) {
  const row = await db
    .select({
      acrValues: cibaRequests.acrValues,
      authorizationDetails: cibaRequests.authorizationDetails,
      authReqId: cibaRequests.authReqId,
      clientId: cibaRequests.clientId,
      expiresAt: cibaRequests.expiresAt,
      scope: cibaRequests.scope,
      status: cibaRequests.status,
      userId: cibaRequests.userId,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.id, requestId))
    .limit(1)
    .get();
  if (!row || row.userId !== userId) {
    throw unknownCibaRequest();
  }
  if (row.status !== "pending") {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description: `This request was already ${row.status}`,
    });
  }
  if (row.expiresAt <= new Date()) {
    throw new APIError("BAD_REQUEST", {
      error: "expired_token",
      error_description: "This request has expired",
    });
  }
  return row;
}

/**
 * Verifies the posted passkey confirmation and records it as the approving
 * authentication, so the ID token's `amr` and `auth_time` describe it.
 */
async function confirmWithPasskey(
  context: AuthContext,
  input: {
    requestId: string;
    response: z.infer<typeof webauthnAssertionSchema>;
    sessionId: string;
    userId: string;
  }
): Promise<AuthenticationState> {
  let verifiedAt: Date;
  try {
    ({ verifiedAt } = await verifyPasskeyStepUp(context.internalAdapter, {
      requestId: input.requestId,
      sessionId: input.sessionId,
      userId: input.userId,
      response: { ...input.response, clientExtensionResults: {} },
    }));
  } catch (error) {
    if (!(error instanceof PasskeyStepUpError)) {
      throw error;
    }
    throw error.reason === "challenge_missing"
      ? cibaDecisionError(
          "BAD_REQUEST",
          "invalid_request",
          "Start the passkey confirmation again"
        )
      : cibaDecisionError(
          "FORBIDDEN",
          "insufficient_user_authentication",
          "Passkey confirmation failed"
        );
  }
  return createAuthenticationContext({
    userId: input.userId,
    loginMethod: "passkey",
    amr: loginMethodToAmr("passkey", { userVerified: true }),
    authenticatedAt: verifiedAt,
    sourceKind: "ciba_approval",
    sourceSessionId: input.sessionId,
    referenceType: "ciba_request",
    referenceId: input.requestId,
  });
}

/**
 * The endpoints Zentity's approval page and push notifications call. They
 * run inside Better Auth, so they share its session handling and the
 * origin check that keeps another site from deciding with the user's cookie.
 * Its `init` makes the CIBA grant name its actor, so register it after
 * `ciba()`.
 */
export function cibaApprovalPlugin(approval: CibaApproval) {
  return {
    id: "zentity-ciba-approval",
    init(context: AuthContext) {
      issueCibaTokensWithActor(context);
    },
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
      cibaDecisionOptions: createAuthEndpoint(
        "/ciba/decision/options",
        {
          method: "POST",
          body: z.object({ request_id: z.string().min(1) }),
          use: [sensitiveSessionMiddleware],
          metadata: { noStore: true },
        },
        async (ctx) => {
          const { session } = ctx.context;
          const requestId = ctx.body.request_id;
          await loadDecidableRequest(requestId, session.user.id);
          const options = await issuePasskeyStepUp(
            ctx.context.internalAdapter,
            {
              requestId,
              sessionId: session.session.id,
              userId: session.user.id,
            }
          );
          if (!options) {
            throw passkeyRequired();
          }
          return ctx.json(options);
        }
      ),
      decideCibaRequest: createAuthEndpoint(
        "/ciba/decision",
        {
          method: "POST",
          body: z.object({
            request_id: z.string().min(1),
            decision: z.enum(["approved", "denied"]),
            // Service workers installed before the channel existed post
            // without one from a notification action.
            channel: z.enum(["push", "page", "email"]).default("push"),
            webauthn: webauthnAssertionSchema.optional(),
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
          const { channel } = ctx.body;
          const row = await loadDecidableRequest(requestId, userId);

          if (ctx.body.decision === "denied") {
            await approval.deny({ channel, requestId, userId });
            return ctx.json({ status: "denied" });
          }

          const policy = approvalPolicy({
            scope: row.scope,
            authorizationDetails: row.authorizationDetails,
          });
          // The channel is client-asserted, so it can only refuse more.
          if (channel === "push" && policy.pageOnly) {
            throw cibaDecisionError(
              "FORBIDDEN",
              "review_required",
              "Open the approval page to review this request"
            );
          }
          await assertAcrSatisfied(userId, row.acrValues);
          if (policy.hasIdentityScopes) {
            const release = await loadReleaseContext(
              releaseIdFor(row.authReqId, row.clientId)
            );
            if (release?.userId !== userId) {
              throw cibaDecisionError(
                "FORBIDDEN",
                "vault_unlock_required",
                "Unlock your vault on the approval page to share this information"
              );
            }
          }

          const userHasPasskey = await hasPasskey(userId);
          const ceremony = requiredCeremony(policy, {
            hasPasskey: userHasPasskey,
          });
          const { webauthn } = ctx.body;
          if (ceremony === "user_verification" && !webauthn) {
            if (!userHasPasskey) {
              throw passkeyRequired();
            }
            throw new APIError("FORBIDDEN", {
              error: "insufficient_user_authentication",
              error_description:
                "Confirm with your passkey to approve this request",
              approval_requirement: "user_verification",
            });
          }

          const authentication = webauthn
            ? await confirmWithPasskey(ctx.context, {
                requestId,
                response: webauthn,
                sessionId: session.session.id,
                userId,
              })
            : await getAuthenticationStateBySessionId(session.session.id);
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
            channel,
            grant: { method: webauthn ? "user_verification" : "session" },
          });
          return ctx.json({ status: "approved" });
        }
      ),
    },
    // Better Auth keys rate-limit counters by IP and path, so each endpoint
    // gets its own limit.
    rateLimit: [
      {
        pathMatcher: (path: string) => path === "/ciba/decision",
        window: 60,
        max: 20,
      },
      {
        pathMatcher: (path: string) => path === "/ciba/decision/options",
        window: 60,
        max: 20,
      },
    ],
  } satisfies BetterAuthPlugin;
}
