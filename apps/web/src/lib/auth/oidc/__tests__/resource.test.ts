import { describe, expect, it } from "vitest";

import { validateResourceUri } from "@/lib/auth/oidc/resource";

describe("validateResourceUri", () => {
  it("accepts a valid HTTPS URL", () => {
    const result = validateResourceUri("https://api.example.com");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts a valid HTTP URL", () => {
    const result = validateResourceUri("http://localhost:3000");
    expect(result.valid).toBe(true);
  });

  it("accepts a URL with a path", () => {
    const result = validateResourceUri("https://api.example.com/v1/resource");
    expect(result.valid).toBe(true);
  });

  it("rejects missing resource", () => {
    expect(validateResourceUri(undefined).valid).toBe(false);
    expect(validateResourceUri(undefined).error).toContain("required");
  });

  it("rejects empty string", () => {
    expect(validateResourceUri("").valid).toBe(false);
    expect(validateResourceUri("").error).toContain("required");
  });

  it("rejects non-string values", () => {
    expect(validateResourceUri(123).valid).toBe(false);
    expect(validateResourceUri(null).valid).toBe(false);
  });

  it("rejects relative URIs", () => {
    const result = validateResourceUri("/api/resource");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("absolute URI");
  });

  it("rejects URIs with a fragment", () => {
    const result = validateResourceUri("https://api.example.com#section");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("fragment");
  });

  it("rejects non-HTTP schemes", () => {
    const result = validateResourceUri("ftp://files.example.com");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("http");
  });

  it("rejects URN-style URIs", () => {
    const result = validateResourceUri("urn:example:resource");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("http");
  });

  it("rejects schemes that start with http but are not http/https", () => {
    expect(validateResourceUri("httpx://evil.com").valid).toBe(false);
    expect(validateResourceUri("https+unix://sock/path").valid).toBe(false);
  });
});
