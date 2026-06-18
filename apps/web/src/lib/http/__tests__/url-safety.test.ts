import { describe, expect, it } from "vitest";

import { isSafePathSegments, validateSafeUrl } from "@/lib/http/url-safety";

describe("validateSafeUrl private-host detection", () => {
  it.each([
    "https://127.0.0.1/p",
    "https://127.0.0.2/p",
    "https://10.0.0.1/p",
    "https://10.255.255.255/p",
    "https://172.16.0.1/p",
    "https://172.31.255.255/p",
    "https://192.168.1.1/p",
    "https://0.0.0.0/p",
    "https://169.254.1.1/p",
    "https://169.254.169.254/p", // AWS metadata endpoint
    "https://[::1]/p",
    "https://[fe80::1]/p",
    "https://[fc00::1]/p",
    "https://[fd12::1]/p",
  ])("rejects %s as private", (url) => {
    expect(validateSafeUrl(url, false)).toContain("private");
  });

  it.each([
    "https://8.8.8.8/p",
    "https://1.1.1.1/p",
    "https://203.0.113.1/p",
    "https://example.com/p",
    "https://[2001:db8::1]/p",
  ])("accepts %s as public", (url) => {
    expect(validateSafeUrl(url, false)).toBeNull();
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

describe("isSafePathSegments", () => {
  it.each([
    [["encrypt"]],
    [["v1", "encrypt"]],
    [["keys", "public-key.json"]],
    [["a", "b_c-d", "e.f.g"]],
  ])("accepts %j", (segments) => {
    expect(isSafePathSegments(segments)).toBe(true);
  });

  it.each([
    [[]],
    [[""]],
    [["."]],
    [[".."]],
    [["..", "encrypt"]],
    [[".hidden"]],
    [["trailing."]],
    [["a/b"]],
    [["a\\b"]],
    [["a b"]],
    [["a?b"]],
    [["%2e%2e"]],
    [[undefined]],
  ])("rejects %j", (segments) => {
    expect(isSafePathSegments(segments)).toBe(false);
  });
});
