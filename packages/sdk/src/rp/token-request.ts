import { importJWK, type JWK, SignJWT } from "jose";
import type { DpopClient } from "./dpop-client";

export interface TokenEndpointResult {
  body: unknown;
  response: Response;
}

/** How a client identifies itself to the token or backchannel endpoint. */
export interface ClientAuthentication {
  /** Issuer audience required by authorization servers using that profile. */
  clientAssertionAudience?: string | undefined;
  clientId: string;
  /** Sends `client_secret_basic` (RFC 6749 §2.3.1); a public client omits it. */
  clientSecret?: string | undefined;
  /** Per-install signing key registered through the client's public JWKS. */
  privateJwk?: JWK | undefined;
  signingAlgorithm?: "ES256" | undefined;
}

function formUrlEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

/**
 * Applies public, client-secret-basic, or private-key-jwt authentication to a
 * form request. Assertions are short-lived and target the configured audience,
 * defaulting to the endpoint URL.
 */
export async function authenticateClientRequest(
  client: ClientAuthentication,
  params: URLSearchParams,
  headers: Record<string, string>,
  endpoint?: string
): Promise<void> {
  if (client.privateJwk) {
    if (!endpoint) {
      throw new Error("private_key_jwt requires the endpoint URL");
    }
    params.delete("client_secret");
    params.set("client_id", client.clientId);
    params.set(
      "client_assertion_type",
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
    );
    const key = await importJWK(
      client.privateJwk,
      client.signingAlgorithm ?? "ES256"
    );
    params.set(
      "client_assertion",
      await new SignJWT({})
        .setProtectedHeader({
          alg: client.signingAlgorithm ?? "ES256",
          typ: "JWT",
        })
        .setIssuer(client.clientId)
        .setSubject(client.clientId)
        .setAudience(client.clientAssertionAudience ?? endpoint)
        .setIssuedAt()
        .setExpirationTime("60s")
        .setJti(globalThis.crypto.randomUUID())
        .sign(key)
    );
    return;
  }
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
    await authenticateClientRequest(client, params, headers, tokenEndpoint);
  }
  const response = await dpopClient.fetch(tokenEndpoint, {
    method: "POST",
    headers,
    body: params,
    ...(client?.privateJwk
      ? {
          onNonceRetry: () =>
            authenticateClientRequest(client, params, headers, tokenEndpoint),
        }
      : {}),
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
