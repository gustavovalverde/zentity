import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth-config";
import { addWwwAuthenticate } from "@/lib/auth/oidc/haip/oauth-response";
import { ensureWalletClientExists } from "@/lib/auth/oidc/wallet-dcr";
import { canonicalizeRequestOrigin } from "@/lib/auth/origin";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";

const { GET: authGET, POST: authPOST } = toNextJsHandler(auth);

async function ensureOidc4vciWalletClientIfNeeded(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/oidc4vci/credential-offer")) {
    await ensureWalletClientExists();
  }
}

/**
 * OID4VCI 1.0 §7.1 has wallets request a `c_nonce` with an empty POST and no
 * Content-Type. Better Auth refuses a POST body without a JSON media type, and
 * the plugin's nonce endpoint does not opt out, so the request reaches it
 * without a body. The endpoint reads none.
 */
function withoutNonceRequestBody(request: Request): Request {
  if (!new URL(request.url).pathname.endsWith("/oidc4vci/nonce")) {
    return request;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
  });
}

export async function GET(request: Request) {
  const canonicalRequest = canonicalizeRequestOrigin(request);
  const requestContext = resolveRequestContext(canonicalRequest.headers);
  attachRequestContextToSpan(requestContext);
  await ensureOidc4vciWalletClientIfNeeded(canonicalRequest);

  const response = await authGET(canonicalRequest);
  return addWwwAuthenticate(response);
}

export async function POST(request: Request) {
  const canonicalRequest = canonicalizeRequestOrigin(request);
  const requestContext = resolveRequestContext(canonicalRequest.headers);
  attachRequestContextToSpan(requestContext);
  await ensureOidc4vciWalletClientIfNeeded(canonicalRequest);
  const response = await authPOST(withoutNonceRequestBody(canonicalRequest));
  return addWwwAuthenticate(response);
}
