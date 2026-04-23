import { getAuthContext, getOAuthContext } from "../runtime/auth-context.js";
import { createDpopProof, extractDpopNonce } from "../runtime/dpop-proof.js";

const dpopNonces = new Map<string, string>();

export async function zentityFetch(
  url: string,
  options?: { method?: string; body?: string }
): Promise<Response> {
  const method = options?.method ?? "GET";
  const auth = getAuthContext();
  const oauth = getOAuthContext(auth);

  const nonceKey = oauth.accountSub || oauth.clientId;
  const dpopNonce = dpopNonces.get(nonceKey);

  let proof = await createDpopProof(
    oauth.dpopKey,
    method,
    url,
    oauth.accessToken,
    dpopNonce
  );

  const headers: Record<string, string> = {
    Authorization: `DPoP ${oauth.accessToken}`,
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
      oauth.dpopKey,
      method,
      url,
      oauth.accessToken,
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
