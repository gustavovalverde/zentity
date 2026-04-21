import "server-only";

import { getProtectedResourceMetadataUrl } from "@/lib/auth/oidc/haip/resource-metadata";

export function addWwwAuthenticate(response: Response): Response {
  if (response.status !== 401 && response.status !== 403) {
    return response;
  }

  const headers = new Headers(response.headers);
  const metadataUrl = getProtectedResourceMetadataUrl();
  const challenge =
    response.status === 401
      ? `Bearer resource_metadata="${metadataUrl}"`
      : `Bearer resource_metadata="${metadataUrl}", error="insufficient_scope"`;
  headers.set("WWW-Authenticate", challenge);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function unwrapBetterAuthEnvelope(
  response: Response
): Promise<Response> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return response;
  }

  const text = await response.clone().text();
  if (!text) {
    return response;
  }

  let payload: { response?: unknown };
  try {
    payload = JSON.parse(text) as { response?: unknown };
  } catch {
    return response;
  }

  if (!(payload && typeof payload === "object" && "response" in payload)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(payload.response), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
