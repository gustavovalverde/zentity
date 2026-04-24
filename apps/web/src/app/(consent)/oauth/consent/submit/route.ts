import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/auth-config";

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
    error_description?: string;
    message?: string;
    redirectURI?: string;
    url?: string;
  } | null;

  const url = readConsentRedirectUrl(body);
  if (!(authResponse.ok && url)) {
    return buildConsentErrorRedirect(
      request,
      body?.error_description ??
        body?.message ??
        "Unable to process consent request."
    );
  }

  const response = NextResponse.redirect(url, { status: 303 });
  appendSetCookieHeaders(authResponse.headers, response.headers);
  return response;
}
