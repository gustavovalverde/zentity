import type { DpopClient } from "./dpop-client";

export interface TokenEndpointResult {
  body: unknown;
  response: Response;
}

/** How a client identifies itself to the token or backchannel endpoint. */
export interface ClientAuthentication {
  clientId: string;
  /** Sends `client_secret_basic` (RFC 6749 §2.3.1); a public client omits it. */
  clientSecret?: string | undefined;
}

function formUrlEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

/**
 * Applies the client's authentication to a form request: `client_id` in the
 * body for a public client, or an `Authorization: Basic` header (both values
 * form-url-encoded first, RFC 6749 §2.3.1) and no `client_id` for a
 * confidential one.
 */
export function authenticateClientRequest(
  client: ClientAuthentication,
  params: URLSearchParams,
  headers: Record<string, string>
): void {
  if (client.clientSecret === undefined) {
    params.set("client_id", client.clientId);
    return;
  }
  params.delete("client_id");
  const credentials = `${formUrlEncode(client.clientId)}:${formUrlEncode(client.clientSecret)}`;
  headers.Authorization = `Basic ${btoa(credentials)}`;
}

export async function requestTokenEndpoint(
  dpopClient: Pick<DpopClient, "fetch">,
  tokenEndpoint: string,
  params: URLSearchParams,
  client?: ClientAuthentication
): Promise<TokenEndpointResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (client) {
    authenticateClientRequest(client, params, headers);
  }
  const response = await dpopClient.fetch(tokenEndpoint, {
    method: "POST",
    headers,
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
