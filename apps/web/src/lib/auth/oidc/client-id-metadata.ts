/**
 * CIMD (Client ID Metadata Document): draft-ietf-oauth-client-id-metadata-document-01.
 *
 * Covers §3 URL validation, §4.1 metadata rules, and the server-side
 * fetch/cache/persist path that resolves URL-formatted client_ids into
 * oauth_clients rows.
 */
import { eq } from "drizzle-orm";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { isPrivateHost as _isPrivateHost } from "@/lib/http/url-safety";
import { logger } from "@/lib/logging/logger";

// ---------------------------------------------------------------------------
// Pure validation (no side-effectful imports, safe for unit tests)
// ---------------------------------------------------------------------------

const isPrivateHost = _isPrivateHost;

/**
 * Detect URL-formatted client_id (MCP CIMD pattern).
 * HTTPS always allowed; http://localhost allowed when not in production.
 */
export function isUrlClientId(
  clientId: string,
  isProduction: boolean
): boolean {
  if (clientId.startsWith("https://")) {
    return true;
  }
  if (!isProduction && clientId.startsWith("http://localhost")) {
    return true;
  }
  return false;
}

export interface CimdMetadata {
  client_id: string;
  client_name: string;
  client_uri?: string | undefined;
  grant_types?: string[] | undefined;
  logo_uri?: string | undefined;
  redirect_uris: string[];
  response_types?: string[] | undefined;
  scope?: string | undefined;
  token_endpoint_auth_method?: string | undefined;
}

export interface CimdValidationResult {
  error?: string;
  metadata?: CimdMetadata;
  valid: boolean;
  warnings?: string[];
}

const ALLOWED_GRANT_TYPES = new Set([
  "authorization_code",
  "refresh_token",
  "urn:openid:params:grant-type:ciba",
]);
const ALLOWED_RESPONSE_TYPES = new Set(["code"]);
const DOT_SEGMENT_RE = /\/\.\.?(?:\/|$|#|\?)/;

const PROHIBITED_FIELDS = new Set([
  "client_secret",
  "client_secret_expires_at",
]);
const SYMMETRIC_AUTH_METHODS = new Set([
  "client_secret_post",
  "client_secret_basic",
  "client_secret_jwt",
]);

function isAbsoluteHttpUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateCimdMetadata(
  url: string,
  raw: unknown,
  isProduction = true
): CimdValidationResult {
  if (!raw || typeof raw !== "object") {
    return { valid: false, error: "metadata document is not a JSON object" };
  }

  const doc = raw as Record<string, unknown>;
  const warnings: string[] = [];

  if (doc.client_id !== url) {
    return {
      valid: false,
      error: `client_id "${String(doc.client_id)}" does not match fetch URL`,
    };
  }

  if (typeof doc.client_name !== "string" || doc.client_name.length === 0) {
    return { valid: false, error: "client_name is required" };
  }

  for (const field of PROHIBITED_FIELDS) {
    if (field in doc) {
      return {
        valid: false,
        error: `metadata document MUST NOT contain "${field}"`,
      };
    }
  }

  if (
    typeof doc.token_endpoint_auth_method === "string" &&
    SYMMETRIC_AUTH_METHODS.has(doc.token_endpoint_auth_method)
  ) {
    return {
      valid: false,
      error: `symmetric auth method "${doc.token_endpoint_auth_method}" is prohibited for CIMD clients`,
    };
  }

  if (
    doc.token_endpoint_auth_method !== undefined &&
    doc.token_endpoint_auth_method !== "none"
  ) {
    return {
      valid: false,
      error: 'token_endpoint_auth_method must be "none" for CIMD clients',
    };
  }

  if (
    !Array.isArray(doc.redirect_uris) ||
    doc.redirect_uris.length === 0 ||
    !doc.redirect_uris.every(
      (uri: unknown) => typeof uri === "string" && isAbsoluteHttpUri(uri)
    )
  ) {
    return {
      valid: false,
      error: "redirect_uris must be a non-empty array of absolute URIs",
    };
  }

  const redirectHosts = new Set<string>();
  for (const uri of doc.redirect_uris) {
    try {
      redirectHosts.add(new URL(uri as string).host);
    } catch {
      return {
        valid: false,
        error: "redirect_uris must be a non-empty array of absolute URIs",
      };
    }
  }
  if (redirectHosts.size > 1) {
    return {
      valid: false,
      error:
        "redirect_uris must share the same host until sector_identifier_uri is supported",
    };
  }

  if (
    doc.grant_types !== undefined &&
    !(
      Array.isArray(doc.grant_types) &&
      doc.grant_types.every(
        (g: unknown) => typeof g === "string" && ALLOWED_GRANT_TYPES.has(g)
      )
    )
  ) {
    return {
      valid: false,
      error:
        'grant_types must be a subset of ["authorization_code", "refresh_token", "urn:openid:params:grant-type:ciba"]',
    };
  }

  if (
    doc.response_types !== undefined &&
    !(
      Array.isArray(doc.response_types) &&
      doc.response_types.every(
        (r: unknown) => typeof r === "string" && ALLOWED_RESPONSE_TYPES.has(r)
      )
    )
  ) {
    return {
      valid: false,
      error: 'response_types must be a subset of ["code"]',
    };
  }

  let clientUri: string | undefined;
  if (typeof doc.client_uri === "string") {
    const err = validateFetchUrl(doc.client_uri, isProduction);
    if (err) {
      return { valid: false, error: `client_uri: ${err}` };
    }
    clientUri = doc.client_uri;
  }

  let logoUri: string | undefined;
  if (typeof doc.logo_uri === "string") {
    const err = validateFetchUrl(doc.logo_uri, isProduction);
    if (err) {
      return { valid: false, error: `logo_uri: ${err}` };
    }
    logoUri = doc.logo_uri;
  }

  const scope = typeof doc.scope === "string" ? doc.scope : undefined;

  return {
    valid: true,
    metadata: {
      client_id: doc.client_id as string,
      client_name: doc.client_name as string,
      redirect_uris: doc.redirect_uris as string[],
      grant_types: doc.grant_types as string[] | undefined,
      response_types: doc.response_types as string[] | undefined,
      token_endpoint_auth_method: doc.token_endpoint_auth_method as
        | string
        | undefined,
      client_uri: clientUri,
      logo_uri: logoUri,
      scope,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Validate a URL for SSRF safety.
 * When `requirePath` is true (default for client_ids), enforces §3 rules
 * (no fragments, dot segments, credentials; must have a path).
 */
export function validateFetchUrl(
  url: string,
  isProduction: boolean,
  requirePath = false
): string | null {
  if (requirePath) {
    if (DOT_SEGMENT_RE.test(url)) {
      return "client_id URL MUST NOT contain dot segments";
    }

    if (url.includes("#")) {
      return "client_id URL MUST NOT contain a fragment";
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "client_id is not a valid URL";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "client_id URL must use HTTPS";
  }

  if (parsed.protocol === "http:" && isProduction) {
    return "client_id URL must use HTTPS in production";
  }

  if (parsed.username || parsed.password) {
    return "client_id URL MUST NOT contain credentials";
  }

  if (requirePath && (parsed.pathname === "/" || parsed.pathname === "")) {
    return "client_id URL MUST contain a path";
  }

  if (!isProduction && parsed.hostname === "localhost") {
    return null;
  }

  if (isPrivateHost(parsed.hostname)) {
    return "client_id URL must not resolve to a private address";
  }

  return null;
}

/**
 * Check if a URL has a query string (§3 SHOULD NOT).
 * Returns a warning string if present, null otherwise.
 */
export function checkUrlQueryWarning(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.search) {
      return "client_id URL SHOULD NOT contain a query string";
    }
  } catch {
    // Already handled by validateFetchUrl
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fetch + cache + persistence
// ---------------------------------------------------------------------------

const CACHE_TTL_FLOOR_MS = 5 * 60 * 1000;
const CACHE_TTL_CEILING_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = CACHE_TTL_CEILING_MS;
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 10 * 1024;

const MAX_AGE_RE = /max-age=(\d+)/;

function parseCacheTtl(response: Response): number {
  const cc = response.headers.get("cache-control");
  if (!cc) {
    return DEFAULT_TTL_MS;
  }
  const match = MAX_AGE_RE.exec(cc);
  if (!match?.[1]) {
    return DEFAULT_TTL_MS;
  }
  const maxAgeSec = Number.parseInt(match[1], 10);
  const maxAgeMs = maxAgeSec * 1000;
  return Math.max(CACHE_TTL_FLOOR_MS, Math.min(maxAgeMs, CACHE_TTL_CEILING_MS));
}

interface FetchResult extends CimdValidationResult {
  cacheTtlMs?: number;
}

async function fetchMetadataDocument(url: string): Promise<FetchResult> {
  const isProduction = env.NODE_ENV === "production";
  const urlError = validateFetchUrl(url, isProduction, true);
  if (urlError) {
    return { valid: false, error: urlError };
  }

  const queryWarning = checkUrlQueryWarning(url);
  if (queryWarning) {
    logger.warn({ url }, queryWarning);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
      redirect: "error",
    });
  } catch {
    return { valid: false, error: "failed to fetch metadata document" };
  }

  if (response.status !== 200) {
    return {
      valid: false,
      error: `metadata document returned HTTP ${response.status}`,
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      valid: false,
      error: `metadata document Content-Type is "${contentType}", expected application/json`,
    };
  }

  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES
  ) {
    return { valid: false, error: "metadata document exceeds 10KB limit" };
  }

  let body: unknown;
  try {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      return { valid: false, error: "metadata document exceeds 10KB limit" };
    }
    body = JSON.parse(text);
  } catch {
    return { valid: false, error: "metadata document is not valid JSON" };
  }

  const cacheTtlMs = parseCacheTtl(response);
  const result = validateCimdMetadata(url, body, isProduction);

  return { ...result, cacheTtlMs };
}

const SECURITY_FIELDS = [
  "redirect_uris",
  "grant_types",
  "token_endpoint_auth_method",
] as const;

function detectMetadataChanges(
  clientId: string,
  oldValues: Record<string, unknown>,
  newMeta: {
    redirect_uris: string[];
    grant_types?: string[] | undefined;
    token_endpoint_auth_method?: string | undefined;
  }
): void {
  for (const field of SECURITY_FIELDS) {
    const oldVal = oldValues[field];
    let newVal: string | undefined;
    if (field === "redirect_uris") {
      newVal = JSON.stringify(newMeta.redirect_uris);
    } else if (field === "grant_types") {
      newVal = newMeta.grant_types
        ? JSON.stringify(newMeta.grant_types)
        : undefined;
    } else {
      newVal = newMeta.token_endpoint_auth_method;
    }

    const oldStr = typeof oldVal === "string" ? oldVal : JSON.stringify(oldVal);
    const newStr = typeof newVal === "string" ? newVal : JSON.stringify(newVal);

    if (oldStr !== newStr) {
      logger.warn(
        { clientId, field, old: oldStr, new: newStr },
        "CIMD metadata security-relevant field changed on refresh"
      );
    }
  }
}

async function prefetchLogoAsDataUri(logoUri: string): Promise<string | null> {
  try {
    const response = await fetch(logoUri, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "error",
    });
    if (response.status !== 200) {
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      return null;
    }
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${contentType.split(";")[0]};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function resolveCimdClient(clientId: string): Promise<{
  resolved: boolean;
  error?: string | undefined;
}> {
  const existing = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.clientId, clientId),
    columns: {
      metadataFetchedAt: true,
      redirectUris: true,
      grantTypes: true,
      tokenEndpointAuthMethod: true,
    },
  });

  if (existing?.metadataFetchedAt) {
    const age = Date.now() - existing.metadataFetchedAt.getTime();
    if (age < DEFAULT_TTL_MS) {
      return { resolved: true };
    }
  }

  const result = await fetchMetadataDocument(clientId);
  if (!(result.valid && result.metadata)) {
    return { resolved: false, error: result.error };
  }

  const meta = result.metadata;
  const now = new Date();

  const iconDataUri = meta.logo_uri
    ? await prefetchLogoAsDataUri(meta.logo_uri)
    : null;

  if (existing) {
    detectMetadataChanges(
      clientId,
      {
        redirect_uris: existing.redirectUris,
        grant_types: existing.grantTypes,
        token_endpoint_auth_method: existing.tokenEndpointAuthMethod,
      },
      meta
    );

    await db
      .update(oauthClients)
      .set({
        name: meta.client_name,
        redirectUris: JSON.stringify(meta.redirect_uris),
        grantTypes: meta.grant_types
          ? JSON.stringify(meta.grant_types)
          : undefined,
        icon: iconDataUri ?? undefined,
        uri: meta.client_uri ?? undefined,
        trustLevel: 1,
        metadataFetchedAt: now,
        updatedAt: now,
      })
      .where(eq(oauthClients.clientId, clientId));
  } else {
    await db.insert(oauthClients).values({
      clientId,
      name: meta.client_name,
      redirectUris: JSON.stringify(meta.redirect_uris),
      grantTypes: meta.grant_types
        ? JSON.stringify(meta.grant_types)
        : JSON.stringify(["authorization_code"]),
      responseTypes: JSON.stringify(["code"]),
      tokenEndpointAuthMethod: meta.token_endpoint_auth_method ?? "none",
      icon: iconDataUri,
      uri: meta.client_uri,
      public: true,
      subjectType: "pairwise",
      trustLevel: 1,
      metadataUrl: clientId,
      metadataFetchedAt: now,
    });
  }

  return { resolved: true };
}
