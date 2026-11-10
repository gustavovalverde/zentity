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
