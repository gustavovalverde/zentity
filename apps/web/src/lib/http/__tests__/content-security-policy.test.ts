import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSP_NONCE_HEADER } from "@/lib/http/content-security-policy";
import { proxy } from "@/proxy";

const NONCE_SOURCE = /'nonce-[^']+'/;

function directive(policy: string | null, name: string): string | undefined {
  return policy
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name} `));
}

function scriptSrc(policy: string | null): string | undefined {
  return directive(policy, "script-src");
}

function connectSrc(policy: string | null): string | undefined {
  return directive(policy, "connect-src");
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

  it("lets development pages reach the configured local Hardhat RPC", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_LOCAL_RPC_URL", "http://127.0.0.1:8565/");

    const policy = proxy(
      new NextRequest("http://localhost:3000/dashboard")
    ).headers.get("Content-Security-Policy");

    expect(connectSrc(policy)).toContain(" http://127.0.0.1:8565 ");
    expect(connectSrc(policy)).not.toContain("http://127.0.0.1:8545");
  });

  it.each(["127.0.0.1:8565", "localhost:8565"])(
    "falls back to the default local RPC when %s has no HTTP scheme",
    (value) => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_LOCAL_RPC_URL", value);

      const policy = proxy(
        new NextRequest("http://localhost:3000/dashboard")
      ).headers.get("Content-Security-Policy");

      expect(connectSrc(policy)).toContain(" http://127.0.0.1:8545 ");
      expect(connectSrc(policy)).not.toContain("null");
    }
  );

  it("leaves API responses and the service worker to their own headers", () => {
    vi.stubEnv("NODE_ENV", "production");

    for (const path of ["/api/trpc/account.get", "/push-sw.js"]) {
      const response = proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(response.headers.get("Content-Security-Policy")).toBeNull();
    }
  });
});
