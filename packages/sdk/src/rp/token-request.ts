import type { DpopClient } from "./dpop-client";

export interface TokenEndpointResult {
  body: unknown;
  response: Response;
}

export async function requestTokenEndpoint(
  dpopClient: DpopClient,
  tokenEndpoint: string,
  params: URLSearchParams
): Promise<TokenEndpointResult> {
  const { response } = await dpopClient.withNonceRetry(async (nonce) => {
    const proof = await dpopClient.proofFor(
      "POST",
      tokenEndpoint,
      undefined,
      nonce
    );
    const attemptResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: proof,
      },
      body: params,
    });
    return { response: attemptResponse, result: null };
  });

  const text = await response.clone().text();
  let body: unknown;
  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  return { body, response };
}
