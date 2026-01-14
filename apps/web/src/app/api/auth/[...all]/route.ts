import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";

const { GET: authGET, POST: authPOST } = toNextJsHandler(auth);

const UNWRAP_PATHS = ["/oauth2/token", "/oidc4vci/credential"];

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

export async function GET(request: Request) {
  const requestContext = await resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  const response = await authGET(request);
  return unwrapIfNeeded(request, response);
}

export async function POST(request: Request) {
  const requestContext = await resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  const response = await authPOST(request);
  return unwrapIfNeeded(request, response);
}
