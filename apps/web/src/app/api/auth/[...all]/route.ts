import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";
import { rewriteDpopForUserinfo } from "@/lib/auth/oidc/haip/dpop";
import { getProtectedResourceMetadataUrl } from "@/lib/auth/oidc/haip/resource-metadata";
import { ensureWalletClientExists } from "@/lib/auth/oidc/wallet-client-registration";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";

const { GET: authGET, POST: authPOST } = toNextJsHandler(auth);

const UNWRAP_PATHS = [
  "/oauth2/token",
  "/oidc4vci/credential",
  "/oauth2/userinfo",
];

async function ensureOidc4vciWalletClientIfNeeded(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/oidc4vci/credential-offer")) {
    await ensureWalletClientExists();
  }
}

async function unwrapIfNeeded(request: Request, response: Response) {
  const url = new URL(request.url);
  const shouldUnwrap = UNWRAP_PATHS.some((suffix) =>
    url.pathname.endsWith(suffix)
  );
  if (!shouldUnwrap) {
    return response;
  }
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

function addWwwAuthenticate(response: Response): Response {
  if (response.status !== 401 && response.status !== 403) {
    return response;
  }

  const headers = new Headers(response.headers);
  const metadataUrl = getProtectedResourceMetadataUrl();

  if (response.status === 401) {
    headers.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${metadataUrl}"`
    );
  } else {
    headers.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${metadataUrl}", error="insufficient_scope"`
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: Request) {
  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  await ensureOidc4vciWalletClientIfNeeded(request);

  let effectiveRequest = request;
  const url = new URL(request.url);
  if (url.pathname.endsWith("/oauth2/userinfo")) {
    try {
      effectiveRequest = await rewriteDpopForUserinfo(request);
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "invalid_dpop_proof",
          error_description:
            err instanceof Error ? err.message : "DPoP validation failed",
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    }
  }

  const response = await authGET(effectiveRequest);
  return addWwwAuthenticate(await unwrapIfNeeded(effectiveRequest, response));
}

export async function POST(request: Request) {
  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  await ensureOidc4vciWalletClientIfNeeded(request);
  const response = await authPOST(request);
  return addWwwAuthenticate(await unwrapIfNeeded(request, response));
}
