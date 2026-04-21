import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth-config";
import { rewriteDpopForUserinfo } from "@/lib/auth/oidc/haip/dpop";
import {
  addWwwAuthenticate,
  unwrapBetterAuthEnvelope,
} from "@/lib/auth/oidc/haip/oauth-response";
import { ensureWalletClientExists } from "@/lib/auth/oidc/wallet-dcr";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";

const { GET: authGET, POST: authPOST } = toNextJsHandler(auth);

const UNWRAP_PATHS = ["/oidc4vci/credential", "/oauth2/userinfo"];

async function ensureOidc4vciWalletClientIfNeeded(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/oidc4vci/credential-offer")) {
    await ensureWalletClientExists();
  }
}

function unwrapIfNeeded(request: Request, response: Response) {
  const url = new URL(request.url);
  const shouldUnwrap = UNWRAP_PATHS.some((suffix) =>
    url.pathname.endsWith(suffix)
  );
  if (!shouldUnwrap) {
    return response;
  }
  return unwrapBetterAuthEnvelope(response);
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
