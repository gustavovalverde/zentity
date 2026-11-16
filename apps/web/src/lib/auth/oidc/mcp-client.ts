import "server-only";

import { randomUUID } from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import {
  isServiceAccountEmail,
  serviceAccountEmail,
} from "@/lib/auth/service-account";
import { db } from "@/lib/db/connection";
import { users } from "@/lib/db/schema/auth";
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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** What a provisioning run writes to: the MCP resource and the database. */
export interface McpProvisioningTarget {
  database: string;
  resource: string;
}

/** The database URL without credentials or query parameters. */
function describeDatabase(url: string): string {
  if (!URL.canParse(url) || url.startsWith("file:")) {
    return url;
  }
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  return parsed.toString();
}

/**
 * The resource and database a provisioning run targets. A production run
 * refuses a loopback `MCP_PUBLIC_URL`, which is what an unset variable
 * defaults to, because the client would be linked to a resource no remote
 * host can reach.
 */
export function mcpProvisioningTarget(): McpProvisioningTarget {
  const resource = env.MCP_PUBLIC_URL;
  const { hostname } = new URL(resource);
  if (
    process.env.NODE_ENV === "production" &&
    (LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost"))
  ) {
    throw new Error(
      `MCP_PUBLIC_URL is ${resource}; set it to the MCP server's public URL before provisioning in production`
    );
  }
  return {
    resource,
    database: describeDatabase(process.env.TURSO_DATABASE_URL ?? ""),
  };
}

export interface McpClientCredentials {
  clientId: string;
  /** Present when the client was created or its secret rotated. */
  clientSecret?: string;
  created: boolean;
}

/**
 * The provider's client administration APIs act only for a signed-in user and
 * change only clients that user owns, so each client gets an owner account of
 * its own, created with it. The owner has no credentials, and provisioning
 * signs it in only for the length of a run. No existing account is ever
 * reused as an owner, so no user can arrange to own the client.
 */
async function createOwner(): Promise<string> {
  const context = await auth.$context;
  const owner = await context.internalAdapter.createUser(
    {
      email: serviceAccountEmail(`mcp-${randomUUID()}`),
      name: "MCP provisioning",
      emailVerified: false,
    },
    { method: "admin" }
  );
  return owner.id;
}

async function withOwnerSession<T>(
  ownerId: string,
  run: (headers: Headers) => Promise<T>
): Promise<T> {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(ownerId);
  const signature = await makeSignature(session.token, context.secret);
  try {
    return await run(
      new Headers({
        cookie: `${context.authCookies.sessionToken.name}=${session.token}.${signature}`,
      })
    );
  } finally {
    await context.internalAdapter.deleteSession(session.token);
  }
}

/**
 * The owner of the client `clientId` names, or null when no such client
 * exists. Refuses a client provisioning did not create, so a mistaken
 * `MCP_CLIENT_ID` cannot turn someone's client into the MCP server's.
 */
async function findProvisionedOwner(clientId: string): Promise<string | null> {
  const row = await db
    .select({ ownerId: oauthClients.userId, ownerEmail: users.email })
    .from(oauthClients)
    .leftJoin(users, eq(users.id, oauthClients.userId))
    .where(eq(oauthClients.clientId, clientId))
    .get();
  if (!row) {
    return null;
  }
  if (
    !(row.ownerId && row.ownerEmail && isServiceAccountEmail(row.ownerEmail))
  ) {
    throw new Error(
      `Client ${clientId} was not created by MCP provisioning; unset MCP_CLIENT_ID to create a new client.`
    );
  }
  return row.ownerId;
}

const clientSettings = {
  scope: MCP_CLIENT_SCOPES.join(" "),
  grant_types: [TOKEN_EXCHANGE_GRANT_TYPE, CIBA_GRANT_TYPE],
  skip_consent: true,
  // The CIBA plugin stores and reads its client fields in `metadata`.
  metadata: { backchannel_token_delivery_mode: "poll" },
};

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
  mcpProvisioningTarget();
  const { clientId } = options;
  const ownerId = clientId ? await findProvisionedOwner(clientId) : null;
  if (!(clientId && ownerId)) {
    return await withOwnerSession(await createOwner(), async (headers) => {
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
    });
  }

  return await withOwnerSession(ownerId, async (headers) => {
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
  });
}
