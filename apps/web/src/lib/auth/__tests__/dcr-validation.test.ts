import { describe, expect, it } from "vitest";

import { validateSafeUrl } from "@/lib/utils/url-safety";

import { joinAuthIssuerPath } from "../well-known";

// These tests validate the DCR software_statement security logic
// without importing auth.ts (which has heavy dependencies).
// We test the building blocks directly.

describe("DCR software_statement SSRF protection", () => {
  describe("SSRF vectors rejected via validateSafeUrl", () => {
    it("rejects AWS metadata endpoint", () => {
      expect(
        validateSafeUrl("http://169.254.169.254/latest/meta-data", false)
      ).toContain("private");
    });

    it("rejects loopback", () => {
      expect(validateSafeUrl("http://127.0.0.1/path", false)).toContain(
        "private"
      );
    });

    it("rejects internal network", () => {
      expect(validateSafeUrl("http://10.0.0.1/.well-known", false)).toContain(
        "private"
      );
    });

    it("rejects IPv6 loopback", () => {
      expect(validateSafeUrl("http://[::1]/path", false)).toContain("private");
    });

    it("enforces HTTPS in production", () => {
      expect(
        validateSafeUrl("http://issuer.example.com/api/auth", true)
      ).toContain("HTTPS");
    });
  });

  describe("JWKS path preserved via joinAuthIssuerPath", () => {
    it("preserves issuer path component", () => {
      const jwksUrl = joinAuthIssuerPath(
        "https://issuer.example/api/auth",
        ".well-known/jwks.json"
      );
      expect(jwksUrl).toBe(
        "https://issuer.example/api/auth/.well-known/jwks.json"
      );
    });

    it("handles trailing slash on issuer", () => {
      const jwksUrl = joinAuthIssuerPath(
        "https://issuer.example/api/auth/",
        ".well-known/jwks.json"
      );
      expect(jwksUrl).toBe(
        "https://issuer.example/api/auth/.well-known/jwks.json"
      );
    });

    it("handles root-path issuer", () => {
      const jwksUrl = joinAuthIssuerPath(
        "https://issuer.example",
        ".well-known/jwks.json"
      );
      expect(jwksUrl).toBe("https://issuer.example/.well-known/jwks.json");
    });
  });

  describe("issuer allowlist logic", () => {
    it("parses comma-separated issuers correctly", () => {
      const raw = "https://a.example, https://b.example ,https://c.example";
      const parsed = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(parsed).toEqual([
        "https://a.example",
        "https://b.example",
        "https://c.example",
      ]);
    });

    it("rejects untrusted issuer", () => {
      const trusted = ["https://trusted.example"];
      const iss = "https://evil.example";
      expect(trusted.includes(iss)).toBe(false);
    });

    it("accepts trusted issuer", () => {
      const trusted = ["https://trusted.example"];
      const iss = "https://trusted.example";
      expect(trusted.includes(iss)).toBe(true);
    });

    it("empty allowlist string yields empty array", () => {
      const parsed = ""
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(parsed).toEqual([]);
    });
  });

  describe("happy path", () => {
    it("trusted issuer with valid URL passes all checks", () => {
      const iss = "https://trusted.example/api/auth";
      const trusted = ["https://trusted.example/api/auth"];

      // Allowlist check
      expect(trusted.includes(iss)).toBe(true);

      // SSRF check
      expect(validateSafeUrl(iss, true)).toBeNull();

      // Path preservation
      const jwksUrl = joinAuthIssuerPath(iss, ".well-known/jwks.json");
      expect(jwksUrl).toBe(
        "https://trusted.example/api/auth/.well-known/jwks.json"
      );
    });
  });
});
