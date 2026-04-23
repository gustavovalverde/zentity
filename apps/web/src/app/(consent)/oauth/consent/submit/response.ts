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

  for (const headerName of ["cookie", "origin", "referer", "user-agent"]) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  return headers;
}

function parseUrl(value: string | null): URL | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function buildConsentErrorRedirect(
  request: Request,
  message: string
): NextResponse {
  const fallbackUrl = new URL("/oauth/consent", request.url);
  const requestOrigin = new URL(request.url).origin;
  const refererUrl = parseUrl(request.headers.get("referer"));
  const targetUrl =
    refererUrl?.origin === requestOrigin ? refererUrl : fallbackUrl;

  targetUrl.searchParams.set("consent_error", message);
  return NextResponse.redirect(targetUrl, { status: 303 });
}

export function appendSetCookieHeaders(
  sourceHeaders: Headers,
  targetHeaders: Headers
): void {
  const getSetCookie = (
    sourceHeaders as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const setCookieHeaders =
    typeof getSetCookie === "function"
      ? getSetCookie.call(sourceHeaders)
      : [sourceHeaders.get("set-cookie")].filter((cookie): cookie is string =>
          Boolean(cookie)
        );

  for (const cookie of setCookieHeaders) {
    targetHeaders.append("set-cookie", cookie);
  }
}
