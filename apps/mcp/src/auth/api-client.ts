import { config } from "../config.js";
import { getAuthContext } from "./context.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";

const dpopNonces = new Map<string, string>();

function getNonceKey(userId: string): string {
  return userId;
}

export async function zentityFetch(
  url: string,
  options?: { method?: string; body?: string }
): Promise<Response> {
  const method = options?.method ?? "GET";
  const auth = getAuthContext();

  // HTTP transport: service token auth (same pattern as FHE/OCR/signer)
  if (config.transport === "http") {
    return serviceTokenFetch(url, method, auth.loginHint, options?.body);
  }

  // stdio transport: DPoP-bound relay with server's keypair
  const nonceKey = getNonceKey(auth.loginHint);
  const dpopNonce = dpopNonces.get(nonceKey);

  let proof = await createDpopProof(
    auth.dpopKey,
    method,
    url,
    auth.accessToken,
    dpopNonce
  );

  const headers: Record<string, string> = {
    Authorization: `DPoP ${auth.accessToken}`,
    DPoP: proof,
  };
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  const fetchBody = options?.body;
  let response = await fetch(url, {
    method,
    headers,
    ...(fetchBody ? { body: fetchBody } : {}),
  });

  // DPoP nonce retry
  const newNonce = extractDpopNonce(response);
  if (
    newNonce &&
    dpopNonce !== newNonce &&
    (response.status === 400 || response.status === 401)
  ) {
    dpopNonces.set(nonceKey, newNonce);
    proof = await createDpopProof(
      auth.dpopKey,
      method,
      url,
      auth.accessToken,
      newNonce
    );
    headers.DPoP = proof;
    response = await fetch(url, {
      method,
      headers,
      ...(fetchBody ? { body: fetchBody } : {}),
    });
  }
  const finalNonce = extractDpopNonce(response);
  if (finalNonce) {
    dpopNonces.set(nonceKey, finalNonce);
  }

  return response;
}

/**
 * Authenticate as a trusted internal service to Zentity.
 * The HTTP transport has already validated the caller's token on ingress;
 * downstream calls use the shared INTERNAL_SERVICE_TOKEN (same as FHE/OCR/signer).
 */
function serviceTokenFetch(
  url: string,
  method: string,
  userId: string,
  body?: string
): Promise<Response> {
  if (!config.internalServiceToken) {
    throw new Error(
      "INTERNAL_SERVICE_TOKEN is required for MCP HTTP transport"
    );
  }

  const headers: Record<string, string> = {
    "x-zentity-internal-token": config.internalServiceToken,
    "x-zentity-user-id": userId,
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(url, { method, headers, ...(body ? { body } : {}) });
}
