import "server-only";

import { makeSignature } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { db } from "@/lib/db/connection";
import {
  oauthClientResources,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

/** What MCP HTTP's tools read: compliance, proofs, profile, and PoH. */
export const MCP_CLIENT_SCOPES = [
  "openid",
  "email",
  "compliance:read",
  "proof:identity",
  "identity.name",
  "identity.dob",
  "identity.address",
  "proof:age",
  "proof:nationality",
  "poh",
];

/**
 * The account that owns the MCP HTTP client. The provider's client
 * administration APIs act only for a signed-in user and change only clients
 * that user owns, so provisioning signs this account in for each run. It has
 * no credentials and never signs in otherwise.
 */
const SERVICE_OWNER = {
  email: "mcp-provisioning@zentity.invalid",
  name: "MCP provisioning",
};

export interface McpClientCredentials {
  clientId: string;
  /** Present when the client was created or its secret rotated. */
  clientSecret?: string;
  created: boolean;
}

async function serviceOwnerHeaders(): Promise<{
  headers: Headers;
  revoke: () => Promise<void>;
}> {
  const context = await auth.$context;
  const owner =
    (await context.internalAdapter.findUserByEmail(SERVICE_OWNER.email))
      ?.user ??
    (await context.internalAdapter.createUser(
      { ...SERVICE_OWNER, emailVerified: false },
      { method: "admin" }
    ));
  const session = await context.internalAdapter.createSession(owner.id);
  const signature = await makeSignature(session.token, context.secret);
  return {
    headers: new Headers({
      cookie: `${context.authCookies.sessionToken.name}=${session.token}.${signature}`,
    }),
    revoke: () => context.internalAdapter.deleteSession(session.token),
  };
}

const clientSettings = {
  scope: MCP_CLIENT_SCOPES.join(" "),
  grant_types: [TOKEN_EXCHANGE_GRANT_TYPE, CIBA_GRANT_TYPE],
  skip_consent: true,
  // The CIBA plugin stores and reads its client fields in `metadata`.
  metadata: { backchannel_token_delivery_mode: "poll" },
};

async function findOwnedClient(clientId: string, ownerEmail: string) {
  const context = await auth.$context;
  const owner = await context.internalAdapter.findUserByEmail(ownerEmail);
  if (!owner) {
    return null;
  }
  return await db
    .select({ clientId: oauthClients.clientId })
    .from(oauthClients)
    .where(
      and(
        eq(oauthClients.clientId, clientId),
        eq(oauthClients.userId, owner.user.id)
      )
    )
    .get();
}

async function isLinked(clientId: string): Promise<boolean> {
  const link = await db
    .select({ id: oauthClientResources.id })
    .from(oauthClientResources)
    .where(
      and(
        eq(oauthClientResources.clientId, clientId),
        eq(oauthClientResources.resourceId, env.MCP_PUBLIC_URL)
      )
    )
    .get();
  return Boolean(link);
}

/**
 * Creates or updates the confidential client MCP HTTP authenticates as, and
 * links it to the MCP resource so it may exchange tokens issued for it. An
 * existing client keeps its secret unless `rotateSecret` is set.
 */
export async function provisionMcpClient(options: {
  clientId?: string | undefined;
  rotateSecret?: boolean;
}): Promise<McpClientCredentials> {
  const { headers, revoke } = await serviceOwnerHeaders();
  try {
    const existing = options.clientId
      ? await findOwnedClient(options.clientId, SERVICE_OWNER.email)
      : null;
    if (!existing) {
      // No redirect URIs, so the provider stores the sector client/<id>.
      const created = await auth.api.adminCreateOAuthClient({
        headers,
        body: {
          ...clientSettings,
          client_name: "Zentity MCP server",
          token_endpoint_auth_method: "client_secret_basic",
          subject_type: "pairwise",
          resources: [env.MCP_PUBLIC_URL],
        },
      });
      return {
        clientId: created.client_id,
        clientSecret: created.client_secret,
        created: true,
      };
    }

    const { clientId } = existing;
    await auth.api.adminUpdateOAuthClient({
      headers,
      body: { client_id: clientId, update: clientSettings },
    });
    if (!(await isLinked(clientId))) {
      await auth.api.adminLinkClientResource({
        headers,
        params: { identifier: env.MCP_PUBLIC_URL, client_id: clientId },
      });
    }
    if (!options.rotateSecret) {
      return { clientId, created: false };
    }
    const rotated = await auth.api.rotateClientSecret({
      headers,
      body: { client_id: clientId },
    });
    return {
      clientId,
      clientSecret: rotated.client_secret,
      created: false,
    };
  } finally {
    await revoke();
  }
}
