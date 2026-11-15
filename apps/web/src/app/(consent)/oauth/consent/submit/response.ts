import { NextResponse } from "next/server";

export function readConsentFormField(
  formData: FormData,
  key: string
): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readConsentRedirectUrl(
  body: { redirectURI?: string; url?: string } | null
): string | null {
  const url = (body?.redirectURI ?? body?.url)?.trim();
  return url || null;
}

export function buildConsentAuthProxyHeaders(request: Request): Headers {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });

  for (const headerName of ["cookie", "user-agent"]) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const refererUrl = URL.parse(request.headers.get("referer") ?? "");
  if (
    origin === requestOrigin ||
    (!origin && refererUrl?.origin === requestOrigin)
  ) {
    headers.set("origin", requestOrigin);
  } else if (origin) {
    headers.set("origin", origin);
  }

  return headers;
}

export function buildConsentErrorRedirect(
  request: Request,
  message: string,
  oauthQuery?: string | null
): NextResponse {
  const requestOrigin = new URL(request.url).origin;
  const refererUrl = URL.parse(request.headers.get("referer") ?? "");

  let targetUrl: URL;
  if (refererUrl?.origin === requestOrigin) {
    targetUrl = refererUrl;
  } else if (oauthQuery) {
    targetUrl = new URL(`/oauth/consent?${oauthQuery}`, request.url);
  } else {
    targetUrl = new URL("/oauth/consent", request.url);
  }

  targetUrl.searchParams.set("consent_error", "consent_failed");
  if (message) {
    targetUrl.searchParams.set("consent_error_description", message);
  }
  return NextResponse.redirect(targetUrl, { status: 303 });
}

export function appendSetCookieHeaders(
  sourceHeaders: Headers,
  targetHeaders: Headers
): void {
  for (const cookie of sourceHeaders.getSetCookie()) {
    targetHeaders.append("set-cookie", cookie);
  }
}
