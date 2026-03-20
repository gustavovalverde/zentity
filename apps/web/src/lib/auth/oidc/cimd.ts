import { eq } from "drizzle-orm";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { logger } from "@/lib/logging/logger";

import {
  type CimdValidationResult,
  checkUrlQueryWarning,
  validateCimdMetadata,
  validateFetchUrl,
} from "./cimd-validation";

const CACHE_TTL_FLOOR_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL_CEILING_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_TTL_MS = CACHE_TTL_CEILING_MS;
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 10 * 1024; // 10KB (IETF draft §6.6 recommends 5KB)

const MAX_AGE_RE = /max-age=(\d+)/;

/**
 * Parse Cache-Control max-age from response headers.
 * Clamps between floor (5min) and ceiling (24h).
 */
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

  // §4: HTTP 200 only (not response.ok which accepts 200-299)
  if (response.status !== 200) {
    return {
      valid: false,
      error: `metadata document returned HTTP ${response.status}`,
    };
  }

  // Content-Type must be application/json
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

/**
 * Prefetch logo_uri and convert to a data URI for safe rendering.
 * Returns null on any failure (SSRF, size, fetch error).
 */
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

  // Prefetch logo if present
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
