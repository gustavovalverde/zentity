import { eq } from "drizzle-orm";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import {
  type CimdValidationResult,
  validateCimdMetadata,
  validateFetchUrl,
} from "./cimd-validation";

const METADATA_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 100 * 1024; // 100KB

async function fetchMetadataDocument(
  url: string
): Promise<CimdValidationResult> {
  const isProduction = env.NODE_ENV === "production";
  const urlError = validateFetchUrl(url, isProduction);
  if (urlError) {
    return { valid: false, error: urlError };
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

  if (!response.ok) {
    return {
      valid: false,
      error: `metadata document returned HTTP ${response.status}`,
    };
  }

  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES
  ) {
    return { valid: false, error: "metadata document exceeds 100KB limit" };
  }

  let body: unknown;
  try {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      return { valid: false, error: "metadata document exceeds 100KB limit" };
    }
    body = JSON.parse(text);
  } catch {
    return { valid: false, error: "metadata document is not valid JSON" };
  }

  return validateCimdMetadata(url, body);
}

export async function resolveCimdClient(clientId: string): Promise<{
  resolved: boolean;
  error?: string;
}> {
  const existing = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.clientId, clientId),
    columns: { metadataFetchedAt: true },
  });

  if (existing?.metadataFetchedAt) {
    const age = Date.now() - existing.metadataFetchedAt.getTime();
    if (age < METADATA_TTL_MS) {
      return { resolved: true };
    }
  }

  const result = await fetchMetadataDocument(clientId);
  if (!(result.valid && result.metadata)) {
    return { resolved: false, error: result.error };
  }

  const meta = result.metadata;
  const now = new Date();

  if (existing) {
    await db
      .update(oauthClients)
      .set({
        name: meta.client_name,
        redirectUris: meta.redirect_uris,
        metadataFetchedAt: now,
        updatedAt: now,
      })
      .where(eq(oauthClients.clientId, clientId));
  } else {
    await db.insert(oauthClients).values({
      clientId,
      name: meta.client_name,
      redirectUris: meta.redirect_uris,
      grantTypes: ["authorization_code"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
      public: true,
      subjectType: "pairwise",
      trustLevel: 0,
      metadataUrl: clientId,
      metadataFetchedAt: now,
    });
  }

  return { resolved: true };
}
