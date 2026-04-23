import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prefixBindingMessage } from "../agent.js";
import { config } from "../config.js";
import { signAgentAssertion } from "../runtime/agent-registration.js";
import {
  getOAuthContext,
  requireAuth,
  tryGetRuntimeState,
} from "../runtime/auth-context.js";
import { type IdentityClaims, redeemRelease } from "./identity-release.js";
import { beginOrResumeInteractiveFlow } from "./interactive-approval.js";
import {
  buildIdentityScopeString,
  buildProfileFieldKey,
  getProtectedProfileFields,
  normalizeProfileFields,
  type PublicProfileField,
} from "./profile-fields.js";

const PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;

interface ProfileName {
  family: string | null;
  full: string | null;
  given: string | null;
}

interface ProfileShape {
  address?: Record<string, unknown> | null;
  birthdate?: string | null;
  name?: ProfileName;
}

interface CachedProfileEntry {
  expiresAt: number;
  profile: ProfileShape;
  returnedFields: PublicProfileField[];
}

export interface ProfileReadResult {
  interaction?: {
    expiresAt: string;
    message: string;
    mode: "url";
    url: string;
  };
  profile: ProfileShape;
  requestedFields: PublicProfileField[];
  returnedFields: PublicProfileField[];
  status:
    | "complete"
    | "denied"
    | "expired"
    | "needs_user_action"
    | "unavailable";
}

const profileCache = new Map<string, CachedProfileEntry>();

function buildProfileCacheKey(input: {
  clientId: string;
  fields: readonly PublicProfileField[];
  runtimeSessionId?: string;
  userId: string;
}): string {
  return [
    input.userId,
    input.clientId,
    input.runtimeSessionId ?? "no-runtime",
    buildProfileFieldKey(input.fields),
  ].join(":");
}

function evictExpiredProfiles(): void {
  const now = Date.now();
  for (const [key, entry] of profileCache.entries()) {
    if (entry.expiresAt <= now) {
      profileCache.delete(key);
    }
  }
}

function asRecordAddress(
  value: IdentityClaims["address"]
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return { formatted: value };
  }
  return value;
}

function mapProfileFromClaims(input: {
  claims: IdentityClaims | null;
  fields: readonly PublicProfileField[];
}): { profile: ProfileShape; returnedFields: PublicProfileField[] } {
  const returnedFields: PublicProfileField[] = [];
  const profile: ProfileShape = {};

  if (input.fields.includes("name")) {
    const full = input.claims?.name ?? null;
    const given = input.claims?.given_name ?? null;
    const family = input.claims?.family_name ?? null;
    profile.name = { full, given, family };
    if (full || given || family) {
      returnedFields.push("name");
    }
  }

  if (input.fields.includes("address")) {
    const address = asRecordAddress(input.claims?.address);
    profile.address = address;
    if (address) {
      returnedFields.push("address");
    }
  }

  if (input.fields.includes("birthdate")) {
    const birthdate = input.claims?.birthdate ?? null;
    profile.birthdate = birthdate;
    if (birthdate) {
      returnedFields.push("birthdate");
    }
  }

  return { profile, returnedFields };
}

export async function readProfile(input: {
  fields: readonly PublicProfileField[];
  server: McpServer;
}): Promise<ProfileReadResult> {
  const auth = await requireAuth();
  const oauth = getOAuthContext(auth);
  const runtime = tryGetRuntimeState(auth);
  const userId = oauth.accountSub || oauth.loginHint;
  const fields = normalizeProfileFields(input.fields);
  const cacheKey = buildProfileCacheKey({
    userId,
    clientId: oauth.clientId,
    fields,
    ...(runtime?.sessionId ? { runtimeSessionId: runtime.sessionId } : {}),
  });

  evictExpiredProfiles();
  const cached = profileCache.get(cacheKey);
  if (cached) {
    return {
      status: "complete",
      requestedFields: fields,
      returnedFields: cached.returnedFields,
      profile: cached.profile,
    };
  }

  const protectedFields = getProtectedProfileFields(fields);

  if (protectedFields.length === 0) {
    const result = mapProfileFromClaims({ claims: null, fields });
    return {
      status: result.returnedFields.length > 0 ? "complete" : "unavailable",
      requestedFields: fields,
      returnedFields: result.returnedFields,
      profile: result.profile,
    };
  }

  const scope = buildIdentityScopeString(protectedFields);
  const bindingMessage = prefixBindingMessage(
    runtime?.display.name ?? "Zentity MCP",
    `Share ${protectedFields.join(", ")} from my profile`
  );
  const agentAssertion = runtime
    ? await signAgentAssertion(runtime, bindingMessage)
    : undefined;

  const flow = await beginOrResumeInteractiveFlow({
    server: input.server,
    toolName: "my_profile",
    fingerprint: [
      userId,
      oauth.clientId,
      runtime?.sessionId ?? "no-runtime",
      "my_profile",
      buildProfileFieldKey(fields),
    ].join(":"),
    oauth,
    cibaRequest: {
      cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
      tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
      clientId: oauth.clientId,
      dpopKey: oauth.dpopKey,
      loginHint: oauth.loginHint || oauth.accountSub,
      scope,
      bindingMessage,
      resource: config.zentityUrl,
      ...(agentAssertion ? { agentAssertion } : {}),
    },
    browserSearchParams: {
      fields: buildProfileFieldKey(fields),
    },
    onApproved: async (approval) => {
      const claims = await redeemRelease(approval.accessToken, oauth.dpopKey);
      const result = mapProfileFromClaims({ claims, fields });

      if (claims) {
        profileCache.set(cacheKey, {
          profile: result.profile,
          returnedFields: result.returnedFields,
          expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
        });
      }

      return result;
    },
  });

  if (flow.status === "complete") {
    return {
      status: flow.data.returnedFields.length > 0 ? "complete" : "unavailable",
      requestedFields: fields,
      returnedFields: flow.data.returnedFields,
      profile: flow.data.profile,
    };
  }

  if (flow.status === "needs_user_action") {
    return {
      status: "needs_user_action",
      requestedFields: fields,
      returnedFields: [],
      profile: {},
      interaction: flow.interaction,
    };
  }

  return {
    status: flow.status,
    requestedFields: fields,
    returnedFields: [],
    profile: {},
  };
}
