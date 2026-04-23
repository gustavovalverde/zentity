import { config } from "../config.js";
import { signAgentAssertion } from "./agent-registration.js";
import {
  beginCibaApproval,
  type CibaPendingApproval,
  type CibaPendingAuthorization,
  createPendingApproval,
  logPendingApprovalHandoff,
  pollCibaTokenOnce,
  requestCibaApproval,
} from "./ciba.js";
import {
  getOAuthContext,
  requireAuth,
  requireRuntimeState,
  tryGetRuntimeState,
} from "./context.js";
import { createDpopProof, type DpopKeyPair, extractDpopNonce } from "./dpop.js";

export interface IdentityClaims {
  address?: string | Record<string, unknown>;
  birthdate?: string;
  family_name?: string;
  given_name?: string;
  name?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  claims: IdentityClaims;
  expiresAt: number;
}

interface PendingIdentityEntry {
  approval: CibaPendingApproval;
  expiresAt: number;
  pendingAuthorization: CibaPendingAuthorization;
}

const identityCache = new Map<string, CacheEntry>();
const pendingIdentityCache = new Map<string, PendingIdentityEntry>();

export type IdentityResolution =
  | { status: "approval_required"; approval: CibaPendingApproval }
  | { claims: IdentityClaims | null; status: "ready" }
  | { message: string; status: "denied" }
  | { message: string; status: "timed_out" };

export function getCachedIdentity(userId?: string): IdentityClaims | null {
  if (!userId) {
    return null;
  }
  const entry = identityCache.get(userId);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    identityCache.delete(userId);
    return null;
  }
  return entry.claims;
}

export async function getIdentity(): Promise<IdentityClaims | null> {
  const auth = await requireAuth();
  const oauth = getOAuthContext(auth);
  const runtime = requireRuntimeState(auth);
  const userId = oauth.accountSub || oauth.loginHint;

  const cached = getCachedIdentity(userId);
  if (cached) {
    return cached;
  }

  const bindingMessage = `${runtime.display.name}: Unlock identity for this session`;
  const agentAssertion = await signAgentAssertion(runtime, bindingMessage);

  const tokenSet = await requestCibaApproval({
    cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
    tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
    clientId: oauth.clientId,
    dpopKey: oauth.dpopKey,
    loginHint: oauth.loginHint,
    scope: "openid identity.name identity.address",
    bindingMessage,
    resource: config.zentityUrl,
    agentAssertion,
    onPendingApproval: logPendingApprovalHandoff,
  });

  const claims = await redeemRelease(tokenSet.accessToken, oauth.dpopKey);
  if (!claims) {
    return null;
  }

  identityCache.set(userId, {
    claims,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return claims;
}

const DEFAULT_IDENTITY_SCOPE = "openid identity.name identity.address";

export async function getIdentityResolution(
  scope: string = DEFAULT_IDENTITY_SCOPE
): Promise<IdentityResolution> {
  const auth = await requireAuth();
  const oauth = getOAuthContext(auth);
  const runtime = tryGetRuntimeState(auth);
  const userId = oauth.accountSub || oauth.loginHint;

  const cached = getCachedIdentity(userId);
  if (cached) {
    return { status: "ready", claims: cached };
  }

  const tokenEndpoint = `${config.zentityUrl}/api/auth/oauth2/token`;
  const pending = pendingIdentityCache.get(userId);

  if (pending) {
    if (pending.expiresAt <= Date.now()) {
      pendingIdentityCache.delete(userId);
    } else {
      return resolvePendingIdentity(userId, oauth, pending, tokenEndpoint);
    }
  }

  return initiateCibaIdentityUnlock(
    userId,
    oauth,
    runtime,
    scope,
    tokenEndpoint
  );
}

async function resolvePendingIdentity(
  userId: string,
  oauth: ReturnType<typeof getOAuthContext>,
  pending: PendingIdentityEntry,
  tokenEndpoint: string
): Promise<IdentityResolution> {
  const pollResult = await pollCibaTokenOnce(
    { clientId: oauth.clientId, dpopKey: oauth.dpopKey, tokenEndpoint },
    pending.pendingAuthorization
  );

  if (pollResult.status === "approved") {
    pendingIdentityCache.delete(userId);
    const claims = await redeemRelease(
      pollResult.tokenSet.accessToken,
      oauth.dpopKey
    );
    if (claims) {
      identityCache.set(userId, {
        claims,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }
    return { status: "ready", claims };
  }

  if (pollResult.status === "pending") {
    const updatedPending = {
      ...pending,
      approval: {
        ...pending.approval,
        expiresIn: getRemainingApprovalSeconds(pending.expiresAt),
        intervalSeconds: pollResult.pendingAuthorization.intervalSeconds,
      },
      pendingAuthorization: pollResult.pendingAuthorization,
    };
    pendingIdentityCache.set(userId, updatedPending);
    return { status: "approval_required", approval: updatedPending.approval };
  }

  pendingIdentityCache.delete(userId);

  if (pollResult.status === "denied") {
    return {
      status: "denied",
      message: `Identity unlock was denied: ${pollResult.message}`,
    };
  }

  return {
    status: "timed_out",
    message:
      "Identity unlock expired. Run whoami again to request a new approval.",
  };
}

async function initiateCibaIdentityUnlock(
  userId: string,
  oauth: ReturnType<typeof getOAuthContext>,
  runtime: ReturnType<typeof tryGetRuntimeState>,
  scope: string,
  tokenEndpoint: string
): Promise<IdentityResolution> {
  const loginHint = oauth.loginHint || oauth.accountSub;
  const bindingMessage = runtime
    ? `${runtime.display.name}: Unlock identity for this session`
    : "Unlock identity for this session";
  const agentAssertion = runtime
    ? await signAgentAssertion(runtime, bindingMessage)
    : undefined;
  const cibaRequest = {
    cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
    tokenEndpoint,
    clientId: oauth.clientId,
    dpopKey: oauth.dpopKey,
    loginHint,
    scope,
    bindingMessage,
    resource: config.zentityUrl,
    agentAssertion,
  };
  const pendingAuthorization = await beginCibaApproval(cibaRequest);
  const approval = createPendingApproval(cibaRequest, pendingAuthorization);

  logPendingApprovalHandoff(approval);
  pendingIdentityCache.set(userId, {
    approval,
    expiresAt: Date.now() + pendingAuthorization.expiresIn * 1000,
    pendingAuthorization,
  });

  return { status: "approval_required", approval };
}

/**
 * Redeem a CIBA access token for PII via the userinfo endpoint.
 */
export function redeemRelease(
  cibaAccessToken: string,
  dpopKey: DpopKeyPair
): Promise<IdentityClaims | null> {
  const userinfoUrl = `${config.zentityUrl}/api/auth/oauth2/userinfo`;
  return redeemViaDpop(userinfoUrl, cibaAccessToken, dpopKey);
}

async function redeemViaDpop(
  userinfoUrl: string,
  cibaAccessToken: string,
  dpopKey: DpopKeyPair
): Promise<IdentityClaims | null> {
  let dpopNonce: string | undefined;

  let proof = await createDpopProof(
    dpopKey,
    "GET",
    userinfoUrl,
    cibaAccessToken,
    dpopNonce
  );
  let response = await fetch(userinfoUrl, {
    headers: { Authorization: `DPoP ${cibaAccessToken}`, DPoP: proof },
  });

  const nonce = extractDpopNonce(response);
  if (
    nonce &&
    dpopNonce !== nonce &&
    (response.status === 400 || response.status === 401)
  ) {
    dpopNonce = nonce;
    proof = await createDpopProof(
      dpopKey,
      "GET",
      userinfoUrl,
      cibaAccessToken,
      dpopNonce
    );
    response = await fetch(userinfoUrl, {
      headers: { Authorization: `DPoP ${cibaAccessToken}`, DPoP: proof },
    });
  }

  return parseUserinfoResponse(response);
}

async function parseUserinfoResponse(
  response: Response
): Promise<IdentityClaims | null> {
  if (!response.ok) {
    console.error(
      `[identity] Userinfo endpoint failed: ${response.status} ${await response.text()}`
    );
    return null;
  }

  const data = (await response.json()) as Record<string, unknown>;
  // Zentity userinfo wraps response in { response: { ... } }
  const userinfo = (
    typeof data.response === "object" && data.response !== null
      ? data.response
      : data
  ) as Record<string, unknown>;

  const name = asOptionalString(userinfo.name);
  const givenName = asOptionalString(userinfo.given_name);
  const familyName = asOptionalString(userinfo.family_name);
  const address = asOptionalAddress(userinfo.address);
  const birthdate = asOptionalString(userinfo.birthdate);

  const claims: IdentityClaims = {
    ...(name ? { name } : {}),
    ...(givenName ? { given_name: givenName } : {}),
    ...(familyName ? { family_name: familyName } : {}),
    ...(address ? { address } : {}),
    ...(birthdate ? { birthdate } : {}),
  };

  if (!(name || givenName || familyName || address || birthdate)) {
    return null;
  }

  return claims;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalAddress(
  value: unknown
): string | Record<string, unknown> | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function getRemainingApprovalSeconds(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}
