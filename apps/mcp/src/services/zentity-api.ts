import { getAuthContext, getOAuthContext } from "../runtime/auth-context.js";

export function zentityFetch(
  url: string,
  options?: { method?: string; body?: string }
): Promise<Response> {
  const oauth = getOAuthContext(getAuthContext());
  const body = options?.body;

  return oauth.dpopClient.fetch(url, {
    method: options?.method ?? "GET",
    accessToken: oauth.accessToken,
    ...(body ? { body, headers: { "Content-Type": "application/json" } } : {}),
  });
}
