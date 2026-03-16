import { config } from "../config.js";
import { getAuthContext } from "./context.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";
import { getServiceTokenHeaders } from "./service-token.js";

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

  // HTTP transport: use service token (no DPoP private key available)
  if (config.transport === "http") {
    return serviceTokenFetch(url, method, auth.loginHint, options?.body);
  }

  // stdio transport: DPoP-bound relay
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

  let response = await fetch(url, {
    method,
    headers,
    body: options?.body,
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
      body: options?.body,
    });
  }
  const finalNonce = extractDpopNonce(response);
  if (finalNonce) {
    dpopNonces.set(nonceKey, finalNonce);
  }

  return response;
}

function serviceTokenFetch(
  url: string,
  method: string,
  userId: string,
  body?: string
): Promise<Response> {
  const headers: Record<string, string> = {
    ...getServiceTokenHeaders(userId),
  };
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(url, { method, headers, body });
}
