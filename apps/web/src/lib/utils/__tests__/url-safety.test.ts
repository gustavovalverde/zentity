import { describe, expect, it } from "vitest";

import { isPrivateHost, validateSafeUrl } from "@/lib/utils/url-safety";

describe("isPrivateHost", () => {
  it.each([
    "127.0.0.1",
    "127.0.0.2",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "0.0.0.0",
    "169.254.1.1",
    "169.254.169.254", // AWS metadata endpoint
    "::1",
    "[::1]",
    "fe80::1",
    "fc00::1",
    "fd12::1",
  ])("detects %s as private", (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "203.0.113.1",
    "example.com",
    "2001:db8::1",
  ])("detects %s as public", (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

describe("validateSafeUrl", () => {
  it("accepts HTTPS URLs", () => {
    expect(validateSafeUrl("https://example.com/path", false)).toBeNull();
    expect(validateSafeUrl("https://example.com/path", true)).toBeNull();
  });

  it("rejects HTTP in production", () => {
    expect(validateSafeUrl("http://example.com/path", true)).toContain("HTTPS");
  });

  it("allows http://localhost in dev", () => {
    expect(validateSafeUrl("http://localhost:3000", false)).toBeNull();
  });

  it("rejects http://localhost in production", () => {
    expect(validateSafeUrl("http://localhost:3000", true)).toContain("HTTPS");
  });

  it("rejects private IPs", () => {
    expect(validateSafeUrl("https://169.254.169.254/meta", false)).toContain(
      "private"
    );
    expect(validateSafeUrl("https://127.0.0.1/path", false)).toContain(
      "private"
    );
    expect(validateSafeUrl("https://10.0.0.1/path", false)).toContain(
      "private"
    );
    expect(validateSafeUrl("https://192.168.1.1/path", false)).toContain(
      "private"
    );
  });

  it("rejects invalid URLs", () => {
    expect(validateSafeUrl("not-a-url", false)).toContain("not valid");
  });

  it("rejects non-HTTP schemes", () => {
    expect(validateSafeUrl("ftp://example.com", false)).toContain("HTTPS");
  });

  it("respects requireHttps=false", () => {
    expect(
      validateSafeUrl("http://example.com", true, { requireHttps: false })
    ).toBeNull();
  });

  it("respects allowLocalhostInDev=false", () => {
    expect(
      validateSafeUrl("http://localhost:3000", false, {
        allowLocalhostInDev: false,
      })
    ).toContain("private");
  });
});
