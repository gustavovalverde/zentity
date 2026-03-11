import { describe, expect, it } from "vitest";

import {
  type CimdMetadata,
  isPrivateHost,
  isUrlClientId,
  validateCimdMetadata,
  validateFetchUrl,
} from "../cimd-validation";

describe("isUrlClientId", () => {
  it("accepts https:// URLs", () => {
    expect(
      isUrlClientId("https://example.com/.well-known/oauth-client", false)
    ).toBe(true);
  });

  it("accepts http://localhost in non-production", () => {
    expect(isUrlClientId("http://localhost:3001/oauth-client", false)).toBe(
      true
    );
  });

  it("rejects http://localhost in production", () => {
    expect(isUrlClientId("http://localhost:3001/oauth-client", true)).toBe(
      false
    );
  });

  it("rejects plain string client IDs", () => {
    expect(isUrlClientId("my-client-id", false)).toBe(false);
  });

  it("rejects http:// non-localhost URLs", () => {
    expect(isUrlClientId("http://example.com/client", false)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isUrlClientId("", false)).toBe(false);
  });
});

describe("isPrivateHost", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "0.0.0.0",
    "169.254.1.1",
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
  ])("detects %s as public", (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

function validMetadata(
  overrides?: Partial<CimdMetadata>
): Record<string, unknown> {
  return {
    client_id: "https://mcp-client.example.com",
    client_name: "MCP Test Client",
    redirect_uris: ["https://mcp-client.example.com/callback"],
    ...overrides,
  };
}

const FETCH_URL = "https://mcp-client.example.com";

describe("validateCimdMetadata", () => {
  it("accepts valid metadata", () => {
    const result = validateCimdMetadata(FETCH_URL, validMetadata());
    expect(result.valid).toBe(true);
    expect(result.metadata?.client_name).toBe("MCP Test Client");
  });

  it("rejects non-object", () => {
    const result = validateCimdMetadata(FETCH_URL, "not an object");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not a JSON object");
  });

  it("rejects null", () => {
    const result = validateCimdMetadata(FETCH_URL, null);
    expect(result.valid).toBe(false);
  });

  it("rejects client_id mismatch", () => {
    const result = validateCimdMetadata(
      FETCH_URL,
      validMetadata({ client_id: "https://other.example.com" })
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("does not match fetch URL");
  });

  it("rejects missing client_name", () => {
    const meta = validMetadata();
    meta.client_name = undefined;
    expect(validateCimdMetadata(FETCH_URL, meta).valid).toBe(false);
  });

  it("rejects empty client_name", () => {
    const result = validateCimdMetadata(
      FETCH_URL,
      validMetadata({ client_name: "" })
    );
    expect(result.valid).toBe(false);
  });

  it("rejects missing redirect_uris", () => {
    const meta = validMetadata();
    meta.redirect_uris = undefined;
    expect(validateCimdMetadata(FETCH_URL, meta).valid).toBe(false);
  });

  it("rejects empty redirect_uris", () => {
    const result = validateCimdMetadata(
      FETCH_URL,
      validMetadata({ redirect_uris: [] })
    );
    expect(result.valid).toBe(false);
  });

  it("rejects relative redirect_uris", () => {
    const result = validateCimdMetadata(
      FETCH_URL,
      validMetadata({ redirect_uris: ["/callback"] })
    );
    expect(result.valid).toBe(false);
  });

  it("rejects disallowed grant_types", () => {
    const result = validateCimdMetadata(
      FETCH_URL,
      validMetadata({ grant_types: ["client_credentials"] })
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("grant_types");
  });

  it("accepts authorization_code grant_type", () => {
    const result = validateCimdMetadata(
      FETCH_URL,
      validMetadata({ grant_types: ["authorization_code"] })
    );
    expect(result.valid).toBe(true);
  });

  it("rejects disallowed response_types", () => {
    const result = validateCimdMetadata(
      FETCH_URL,
      validMetadata({ response_types: ["token"] })
    );
    expect(result.valid).toBe(false);
  });

  it("rejects non-none token_endpoint_auth_method", () => {
    const result = validateCimdMetadata(
      FETCH_URL,
      validMetadata({ token_endpoint_auth_method: "client_secret_basic" })
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("token_endpoint_auth_method");
  });

  it("accepts token_endpoint_auth_method=none", () => {
    const result = validateCimdMetadata(
      FETCH_URL,
      validMetadata({ token_endpoint_auth_method: "none" })
    );
    expect(result.valid).toBe(true);
  });

  it("accepts omitted optional fields", () => {
    const result = validateCimdMetadata(FETCH_URL, validMetadata());
    expect(result.valid).toBe(true);
    expect(result.metadata?.grant_types).toBeUndefined();
    expect(result.metadata?.response_types).toBeUndefined();
    expect(result.metadata?.token_endpoint_auth_method).toBeUndefined();
  });
});

describe("validateFetchUrl", () => {
  it("accepts HTTPS URLs", () => {
    expect(validateFetchUrl("https://example.com/client", false)).toBeNull();
  });

  it("accepts http://localhost in non-production", () => {
    expect(validateFetchUrl("http://localhost:3001/client", false)).toBeNull();
  });

  it("rejects http://localhost in production", () => {
    expect(validateFetchUrl("http://localhost:3001/client", true)).toContain(
      "HTTPS"
    );
  });

  it("rejects private IPs", () => {
    expect(validateFetchUrl("https://192.168.1.1/client", false)).toContain(
      "private"
    );
  });

  it("rejects non-URL strings", () => {
    expect(validateFetchUrl("not a url", false)).toContain("not a valid URL");
  });

  it("rejects ftp:// scheme", () => {
    expect(validateFetchUrl("ftp://example.com/client", false)).toContain(
      "HTTPS"
    );
  });

  it("rejects loopback in SSRF check", () => {
    expect(validateFetchUrl("https://127.0.0.1/client", false)).toContain(
      "private"
    );
  });
});
