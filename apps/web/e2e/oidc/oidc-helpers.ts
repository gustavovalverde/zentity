import crypto from "node:crypto";

import { createClient } from "@libsql/client";
import {
  type APIRequestContext,
  type APIResponse,
  expect,
  request as playwrightRequest,
} from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  jwtVerify,
  SignJWT,
} from "jose";

// Minimal schema for E2E credential lookup (Playwright can't resolve @/ imports)
const oidc4vciIssuedCredentials = sqliteTable("oidc4vci_issued_credential", {
  id: text("id").primaryKey(),
  credential: text("credential").notNull(),
  status: integer("status").notNull(),
  statusListId: text("status_list_id").notNull(),
  statusListIndex: integer("status_list_index").notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
});

const RAW_BASE_URL =
  process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3000";
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");
const AUTH_BASE_URL = `${BASE_URL}/api/auth`;
const ISSUER = AUTH_BASE_URL;
const ORIGIN_HEADERS = {
  Origin: BASE_URL,
  "Content-Type": "application/json",
};

// --- Cookie Utilities ---

function buildCookieHeader(cookies: string | string[] | undefined): string {
  if (!cookies) {
    throw new Error("Missing set-cookie header from auth response");
  }
  const cookieStrings = Array.isArray(cookies) ? cookies : [cookies];
  const values = cookieStrings
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean);
  if (!values.length) {
    throw new Error("Unable to parse session cookies");
  }
  return values.join("; ");
}

function readSetCookieHeader(response: APIResponse): string[] | undefined {
  const values = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value);
  return values.length ? values : undefined;
}

async function buildCookieHeaderFromContext(
  request: APIRequestContext
): Promise<string> {
  const state = await request.storageState();
  const values = state.cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .filter(Boolean);
  if (!values.length) {
    throw new Error("No cookies available in request context");
  }
  return values.join("; ");
}

// --- Auth API Helpers ---

interface AuthResult {
  cookies: string[] | undefined;
  userId?: string;
  email?: string | null;
}

async function readAuthUser(
  response: Awaited<ReturnType<APIRequestContext["post"]>>
): Promise<{ userId?: string; email?: string | null }> {
  const body = (await response.json().catch(() => null)) as {
    user?: { id?: string; email?: string | null } | null;
  } | null;
  return {
    userId: body?.user?.id,
    email: body?.user?.email ?? null,
  };
}

function signUpViaApi(
  request: APIRequestContext,
  email: string,
  password: string,
  name: string
) {
  return request.post(`${AUTH_BASE_URL}/sign-up/email`, {
    data: { email, password, name },
    headers: ORIGIN_HEADERS,
  });
}

function signInAnonymousViaApi(request: APIRequestContext) {
  return request.post(`${AUTH_BASE_URL}/sign-in/anonymous`, {
    data: {},
    headers: ORIGIN_HEADERS,
  });
}

function signInViaApi(
  request: APIRequestContext,
  email: string,
  password: string
) {
  return request.post(`${AUTH_BASE_URL}/sign-in/email`, {
    data: { email, password },
    headers: ORIGIN_HEADERS,
  });
}

// --- Auth Strategy Functions ---

async function trySignUp(
  ctx: APIRequestContext,
  email: string,
  password: string,
  name: string
): Promise<AuthResult | null> {
  const res = await signUpViaApi(ctx, email, password, name);
  if (!res.ok()) {
    return null;
  }
  const cookies = readSetCookieHeader(res);
  const authUser = await readAuthUser(res);
  return { cookies, userId: authUser.userId, email: authUser.email };
}

async function trySignIn(
  ctx: APIRequestContext,
  email: string,
  password: string
): Promise<AuthResult | null> {
  const res = await signInViaApi(ctx, email, password);
  if (!res.ok()) {
    return null;
  }
  const cookies = readSetCookieHeader(res);
  const authUser = await readAuthUser(res);
  return { cookies, userId: authUser.userId, email: authUser.email };
}

async function tryAnonymous(ctx: APIRequestContext): Promise<AuthResult> {
  const res = await signInAnonymousViaApi(ctx);
  if (!res.ok()) {
    throw new Error(`Failed to sign in anonymously: ${await res.text()}`);
  }
  const cookies = readSetCookieHeader(res);
  const authUser = await readAuthUser(res);
  return { cookies, userId: authUser.userId, email: authUser.email };
}

async function resolveSessionUserId(
  ctx: APIRequestContext,
  cookieHeader: string
): Promise<{ userId: string; email: string | null }> {
  const res = await ctx.get(`${AUTH_BASE_URL}/get-session`, {
    headers: cookieHeader
      ? { Cookie: cookieHeader, Origin: BASE_URL }
      : { Origin: BASE_URL },
  });
  if (!res.ok()) {
    throw new Error(`Unable to resolve session user id: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    user?: { id?: string; email?: string | null } | null;
  };
  const userId = body.user?.id;
  if (!userId) {
    throw new Error("Unable to resolve session user id");
  }
  return { userId, email: body.user?.email ?? null };
}

// --- Session Creation ---

let cachedIssuerSession: {
  cookieHeader: string;
  userId: string;
  email: string;
} | null = null;

export async function createIssuerSession(_request: APIRequestContext) {
  if (cachedIssuerSession) {
    return cachedIssuerSession;
  }

  const email = `oidc-e2e-${crypto.randomUUID()}@example.com`;
  const password = "TestPassword123!";
  const name = email.split("@")[0] ?? "oidc";
  const preferAnonymous =
    process.env.E2E_OIDC_ONLY === "true" &&
    process.env.E2E_OIDC_PREFER_ANON === "true";

  const authContext = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: ORIGIN_HEADERS,
    storageState: { cookies: [], origins: [] },
  });

  try {
    // Try auth strategies in order of preference
    let result: AuthResult | null = null;

    if (preferAnonymous) {
      result = await tryAnonymous(authContext);
    } else {
      result =
        (await trySignUp(authContext, email, password, name)) ??
        (await trySignIn(authContext, email, password)) ??
        (await tryAnonymous(authContext));
    }

    // Build cookie header from result or context
    let cookieHeader = result.cookies?.length
      ? buildCookieHeader(result.cookies)
      : "";
    if (!cookieHeader) {
      try {
        cookieHeader = await buildCookieHeaderFromContext(authContext);
      } catch {
        cookieHeader = "";
      }
    }

    // Resolve user ID if not already available
    let userId = result.userId;
    let resolvedEmail = result.email ?? email;

    if (!userId) {
      const session = await resolveSessionUserId(authContext, cookieHeader);
      userId = session.userId;
      resolvedEmail = session.email ?? resolvedEmail;
    }

    const finalCookieHeader =
      cookieHeader || (await buildCookieHeaderFromContext(authContext));

    cachedIssuerSession = {
      cookieHeader: finalCookieHeader,
      userId,
      email: resolvedEmail ?? email,
    };

    return cachedIssuerSession;
  } finally {
    await authContext.dispose();
  }
}

// --- OAuth/OIDC4VCI Helpers ---

export async function createWalletClient(
  request: APIRequestContext,
  cookieHeader: string
) {
  const res = await request.post(`${AUTH_BASE_URL}/oauth2/create-client`, {
    data: {
      redirect_uris: ["https://wallet.example/cb"],
      token_endpoint_auth_method: "none",
      skip_consent: true,
    },
    headers: {
      Cookie: cookieHeader,
      ...ORIGIN_HEADERS,
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) {
    throw new Error("Missing client_id from OAuth client creation");
  }
  return body.client_id;
}

export async function createCredentialOffer(
  request: APIRequestContext,
  input: {
    cookieHeader: string;
    clientId: string;
    userId: string;
    credentialConfigurationId: string;
  }
) {
  const res = await request.post(`${AUTH_BASE_URL}/oidc4vci/credential-offer`, {
    data: {
      client_id: input.clientId,
      userId: input.userId,
      credential_configuration_id: input.credentialConfigurationId,
    },
    headers: {
      Cookie: input.cookieHeader,
      ...ORIGIN_HEADERS,
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    credential_offer?: {
      grants?: {
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"?: {
          "pre-authorized_code"?: string;
        };
      };
    };
  };
  const preAuthorizedCode =
    body.credential_offer?.grants?.[
      "urn:ietf:params:oauth:grant-type:pre-authorized_code"
    ]?.["pre-authorized_code"];
  if (!preAuthorizedCode) {
    throw new Error("Missing pre-authorized code in credential offer");
  }
  return { preAuthorizedCode, offer: body.credential_offer };
}

export async function exchangePreAuthorizedCode(
  request: APIRequestContext,
  input: { preAuthorizedCode: string; clientId?: string }
) {
  const form = new URLSearchParams();
  form.set(
    "grant_type",
    "urn:ietf:params:oauth:grant-type:pre-authorized_code"
  );
  form.set("pre-authorized_code", input.preAuthorizedCode);
  if (input.clientId) {
    form.set("client_id", input.clientId);
  }

  const res = await request.post(`${AUTH_BASE_URL}/oauth2/token`, {
    data: form.toString(),
    headers: {
      Origin: BASE_URL,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return res;
}

export async function createProofJwt(cNonce: string) {
  const holder = await generateKeyPair("EdDSA");
  const holderJwk = (await exportJWK(holder.publicKey)) as JWK;
  const proofJwt = await new SignJWT({ nonce: cNonce })
    .setProtectedHeader({
      alg: "EdDSA",
      jwk: holderJwk,
      typ: "openid4vci-proof+jwt",
    })
    .setIssuedAt()
    .setAudience(ISSUER)
    .sign(holder.privateKey);

  return { proofJwt, holderJwk };
}

export async function issueCredential(
  request: APIRequestContext,
  input: {
    accessToken: string;
    credentialConfigurationId?: string;
    credentialIdentifier?: string;
    // Draft 11 backwards compatibility: use format instead of credential_configuration_id
    format?: string;
    vct?: string;
    proofJwt: string;
  }
) {
  // Build request body - only include fields that are defined
  const data: Record<string, unknown> = {
    proofs: { jwt: [input.proofJwt] },
  };
  if (input.credentialConfigurationId !== undefined) {
    data.credential_configuration_id = input.credentialConfigurationId;
  }
  if (input.credentialIdentifier !== undefined) {
    data.credential_identifier = input.credentialIdentifier;
  }
  // Draft 11 format-based request
  if (input.format !== undefined) {
    data.format = input.format;
  }
  if (input.vct !== undefined) {
    data.vct = input.vct;
  }

  const res = await request.post(`${AUTH_BASE_URL}/oidc4vci/credential`, {
    data,
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      ...ORIGIN_HEADERS,
    },
  });

  return res;
}

export async function fetchIssuerJwks(request: APIRequestContext) {
  const res = await request.get(`${AUTH_BASE_URL}/jwks`);
  expect(res.ok()).toBeTruthy();
  const jwks = (await res.json()) as { keys?: JWK[] };
  if (!jwks.keys?.length) {
    throw new Error("Issuer JWKS missing keys");
  }
  return { keys: jwks.keys };
}

export async function verifyIssuedCredential(input: {
  credential: string;
  userId: string;
  holderJwk: JWK;
  jwks: { keys: JWK[] };
  expectedVct: string;
}) {
  const [sdJwt] = input.credential.split("~");
  if (!sdJwt) {
    throw new Error("Credential missing SD-JWT payload");
  }
  const jwkSet = createLocalJWKSet(input.jwks);
  const verified = await jwtVerify(sdJwt, jwkSet, { issuer: ISSUER });
  const payload = verified.payload as Record<string, unknown>;
  expect(payload.sub).toBe(input.userId);
  expect(payload.vct).toBe(input.expectedVct);

  const expectedJkt = await calculateJwkThumbprint(input.holderJwk);
  const cnf = payload.cnf as { jkt?: string } | undefined;
  expect(cnf?.jkt).toBe(expectedJkt);
  return payload;
}

export async function findIssuedCredentialRecord(credential: string) {
  const dbUrl =
    process.env.E2E_TURSO_DATABASE_URL ||
    process.env.TURSO_DATABASE_URL ||
    process.env.E2E_DATABASE_PATH;

  if (!dbUrl) {
    throw new Error("Missing database URL for E2E credential lookup");
  }

  const url =
    dbUrl.startsWith("file:") || dbUrl.startsWith("libsql:")
      ? dbUrl
      : `file:${dbUrl}`;

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const db = drizzle(client, { schema: { oidc4vciIssuedCredentials } });

  try {
    const rows = await db
      .select({
        id: oidc4vciIssuedCredentials.id,
        status: oidc4vciIssuedCredentials.status,
        statusListId: oidc4vciIssuedCredentials.statusListId,
        statusListIndex: oidc4vciIssuedCredentials.statusListIndex,
        revokedAt: oidc4vciIssuedCredentials.revokedAt,
      })
      .from(oidc4vciIssuedCredentials)
      .where(eq(oidc4vciIssuedCredentials.credential, credential))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new Error("Issued credential record not found");
    }
    return row;
  } finally {
    client.close();
  }
}

export const oidcConfig = {
  baseUrl: BASE_URL,
  authBaseUrl: AUTH_BASE_URL,
  issuer: ISSUER,
};

export const originHeaders = ORIGIN_HEADERS;
