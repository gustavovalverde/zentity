/**
 * OIDC4VCI Credential Endpoint
 *
 * Forwards credential requests to better-auth OIDC4VCI plugin for SD-JWT issuance.
 * BBS+ credentials are not exposed via OIDC4VCI; they're used internally for
 * wallet binding (RFC-0020) via the crypto.bbs tRPC router.
 */

import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";

const { POST: authPOST } = toNextJsHandler(auth);

export async function POST(request: Request): Promise<Response> {
  const response = await authPOST(request);

  // Unwrap nested response if present (matching catch-all behavior)
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return response;
  }

  const text = await response.clone().text();
  if (!text) {
    return response;
  }

  try {
    const payload = JSON.parse(text) as { response?: unknown };
    if (payload && typeof payload === "object" && "response" in payload) {
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json");
      return new Response(JSON.stringify(payload.response), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
  } catch {
    return response;
  }

  return response;
}
