import { getAuthContext, getOAuthContext } from "../runtime/auth-context.js";

const dpopNonces = new Map<string, string>();

export async function zentityFetch(
  url: string,
  options?: { method?: string; body?: string }
): Promise<Response> {
  const method = (options?.method ?? "GET").toUpperCase();
  const oauth = getOAuthContext(getAuthContext());
  const nonceKey = oauth.accountSub || oauth.clientId;
  const cachedNonce = dpopNonces.get(nonceKey);
  const body = options?.body;

  const { response } = await oauth.dpopClient.withNonceRetry(async (nonce) => {
    const proof = await oauth.dpopClient.proofFor(
      method,
      url,
      oauth.accessToken,
      nonce ?? cachedNonce
    );
    const headers: Record<string, string> = {
      Authorization: `DPoP ${oauth.accessToken}`,
      DPoP: proof,
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }
    const attemptResponse = await fetch(url, {
      method,
      headers,
      ...(body ? { body } : {}),
    });
    return { response: attemptResponse, result: null };
  });

  const finalNonce = response.headers.get("DPoP-Nonce");
  if (finalNonce) {
    dpopNonces.set(nonceKey, finalNonce);
  }

  return response;
}
