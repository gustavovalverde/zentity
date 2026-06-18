import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/auth-config";
import { getAppOrigin } from "@/lib/auth/origin";
import { logger } from "@/lib/logging/logger";

import {
  appendSetCookieHeaders,
  buildConsentAuthProxyHeaders,
  buildConsentErrorRedirect,
  readConsentFormField,
  readConsentRedirectUrl,
} from "./response";

const { POST: authPOST } = toNextJsHandler(auth);

export async function POST(request: Request): Promise<NextResponse> {
  const formData = await request.formData();
  const accept = readConsentFormField(formData, "accept") === "true";
  const scope = readConsentFormField(formData, "scope");
  const oauthQuery = readConsentFormField(formData, "oauth_query");

  const authRequest = new Request(
    new URL("/api/auth/oauth2/consent", request.url),
    {
      method: "POST",
      headers: buildConsentAuthProxyHeaders(request),
      body: JSON.stringify({
        accept,
        ...(scope ? { scope } : {}),
        ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
      }),
    }
  );

  const authResponse = await authPOST(authRequest);
  const body = (await authResponse.json().catch(() => null)) as {
    error?: string;
    error_description?: string;
    message?: string;
    redirectURI?: string;
    url?: string;
  } | null;

  const url = readConsentRedirectUrl(body);
  if (!(authResponse.ok && url)) {
    logger.warn(
      {
        status: authResponse.status,
        error: body?.error,
        errorDescription: body?.error_description,
        message: body?.message,
        hasOauthQuery: Boolean(oauthQuery),
        accept,
        scope,
      },
      "oauth consent submit rejected by better-auth"
    );
    return buildConsentErrorRedirect(
      request,
      body?.error_description ??
        body?.message ??
        "Unable to process consent request.",
      oauthQuery
    );
  }

  // better-auth's consent endpoint may return a relative redirect (e.g. a
  // re-prompt back to `/oauth/consent`); `NextResponse.redirect` requires an
  // absolute URL. Resolve against the canonical app origin rather than
  // `request.url`, whose host follows the dev server bind address (e.g.
  // `0.0.0.0`) and would otherwise leave a trusted origin. Absolute callback
  // URLs (the RP redirect_uri with the code) pass through unchanged.
  const response = NextResponse.redirect(new URL(url, getAppOrigin()), {
    status: 303,
  });
  appendSetCookieHeaders(authResponse.headers, response.headers);
  return response;
}
