import { describe, expect, it } from "vitest";

import {
  appendSetCookieHeaders,
  buildConsentErrorRedirect,
  readConsentRedirectUrl,
} from "../submit/response";

function getSetCookieHeaders(headers: Headers): string[] {
  return (headers as Headers & { getSetCookie: () => string[] }).getSetCookie();
}

describe("consent submit response helpers", () => {
  it("reads Better Auth redirectURI consent responses", () => {
    expect(
      readConsentRedirectUrl({
        redirectURI: " https://rp.example/callback?code=abc ",
      })
    ).toBe("https://rp.example/callback?code=abc");
  });

  it("keeps url as a consent redirect fallback", () => {
    expect(
      readConsentRedirectUrl({
        url: " https://rp.example/callback?code=abc ",
      })
    ).toBe("https://rp.example/callback?code=abc");
  });

  it("redirects consent errors back to a same-origin referer", () => {
    const request = new Request(
      "https://app.zentity.test/oauth/consent/submit",
      {
        headers: {
          referer:
            "https://app.zentity.test/oauth/consent?client_id=client-1&scope=openid",
        },
      }
    );

    const response = buildConsentErrorRedirect(request, "Consent failed");
    const location = response.headers.get("location");

    expect(response.status).toBe(303);
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location as string);
    expect(redirectUrl.origin).toBe("https://app.zentity.test");
    expect(redirectUrl.pathname).toBe("/oauth/consent");
    expect(redirectUrl.searchParams.get("client_id")).toBe("client-1");
    expect(redirectUrl.searchParams.get("consent_error")).toBe(
      "Consent failed"
    );
  });

  it("ignores cross-origin referers on consent error redirects", () => {
    const request = new Request(
      "https://app.zentity.test/oauth/consent/submit",
      {
        headers: {
          referer: "https://attacker.test/callback",
        },
      }
    );

    const response = buildConsentErrorRedirect(request, "Consent failed");
    const location = response.headers.get("location");

    expect(location).toBeTruthy();
    const redirectUrl = new URL(location as string);
    expect(redirectUrl.origin).toBe("https://app.zentity.test");
    expect(redirectUrl.pathname).toBe("/oauth/consent");
    expect(redirectUrl.searchParams.get("consent_error")).toBe(
      "Consent failed"
    );
  });

  it("preserves multiple set-cookie headers", () => {
    const sourceHeaders = new Headers();
    sourceHeaders.append("set-cookie", "session=abc; Path=/; HttpOnly");
    sourceHeaders.append("set-cookie", "csrf=def; Path=/; Secure");
    const targetHeaders = new Headers();

    appendSetCookieHeaders(sourceHeaders, targetHeaders);

    expect(getSetCookieHeaders(targetHeaders)).toEqual([
      "session=abc; Path=/; HttpOnly",
      "csrf=def; Path=/; Secure",
    ]);
  });
});
