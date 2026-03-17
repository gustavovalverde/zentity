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

  // HTTP transport: relay the caller's DPoP-bound access token
  if (config.transport === "http") {
    return httpRelayFetch(url, method, auth, options?.body);
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
 * Relay the caller's DPoP-bound access token to Zentity.
 * The HTTP transport validates the caller's token on ingress and
 * forwards it as-is to downstream Zentity API calls.
 */
function httpRelayFetch(
  url: string,
  method: string,
  auth: { accessToken: string; callerDpopProof?: string | undefined },
  body?: string
): Promise<Response> {
  const headers: Record<string, string> = {};

  if (auth.callerDpopProof) {
    headers.Authorization = `DPoP ${auth.accessToken}`;
    headers.DPoP = auth.callerDpopProof;
  } else {
    headers.Authorization = `Bearer ${auth.accessToken}`;
  }

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(url, { method, headers, ...(body ? { body } : {}) });
}
