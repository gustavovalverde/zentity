import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSP_NONCE_HEADER } from "@/lib/http/content-security-policy";
import { proxy } from "@/proxy";

const NONCE_SOURCE = /'nonce-[^']+'/;

function scriptSrc(policy: string | null): string | undefined {
  return policy
    ?.split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("script-src"));
}

describe("content security policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows production scripts only from this origin or with a fresh nonce", () => {
    vi.stubEnv("NODE_ENV", "production");

    const first = proxy(new NextRequest("http://localhost:3000/dashboard"));
    const second = proxy(new NextRequest("http://localhost:3000/dashboard"));

    const firstScripts = scriptSrc(
      first.headers.get("Content-Security-Policy")
    );
    expect(firstScripts).toMatch(NONCE_SOURCE);
    expect(firstScripts).not.toContain("'unsafe-inline'");
    expect(firstScripts).not.toContain("'unsafe-eval'");
    expect(firstScripts).not.toBe(
      scriptSrc(second.headers.get("Content-Security-Policy"))
    );
  });

  it("hands the nonce to the page render", () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = proxy(new NextRequest("http://localhost:3000/sign-in"));
    const nonce = response.headers.get(
      `x-middleware-request-${CSP_NONCE_HEADER}`
    );

    expect(nonce).toBeTruthy();
    expect(response.headers.get("Content-Security-Policy")).toContain(
      `'nonce-${nonce}'`
    );
  });

  it("leaves API responses and the service worker to their own headers", () => {
    vi.stubEnv("NODE_ENV", "production");

    for (const path of ["/api/trpc/account.get", "/push-sw.js"]) {
      const response = proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(response.headers.get("Content-Security-Policy")).toBeNull();
    }
  });
});
