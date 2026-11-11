import type { DpopClient } from "./dpop-client";

export interface TokenEndpointResult {
  body: unknown;
  response: Response;
}

export async function requestTokenEndpoint(
  dpopClient: Pick<DpopClient, "fetch">,
  tokenEndpoint: string,
  params: URLSearchParams
): Promise<TokenEndpointResult> {
  const response = await dpopClient.fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
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
