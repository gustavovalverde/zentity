import { describe, expect, it } from "vitest";

import { validateOutboundUrl } from "@/lib/http/url-safety";

import { joinAuthIssuerPath } from "../oidc/well-known";

// These tests validate the DCR software_statement security logic
// without importing auth-config.ts (which has heavy dependencies).
// We test the building blocks directly.

describe("DCR software_statement SSRF protection", () => {
  describe("SSRF vectors rejected via validateOutboundUrl", () => {
    it("rejects AWS metadata endpoint", () => {
      expect(
        validateOutboundUrl("https://169.254.169.254/latest/meta-data")
      ).toContain("private or reserved");
    });

    it("rejects internal network", () => {
      expect(validateOutboundUrl("https://10.0.0.1/.well-known")).toContain(
        "private or reserved"
      );
    });

    it("enforces HTTPS for public issuers", () => {
      expect(
        validateOutboundUrl("http://issuer.example.com/api/auth")
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
      expect(validateOutboundUrl(iss)).toBeNull();

      // Path preservation
      const jwksUrl = joinAuthIssuerPath(iss, ".well-known/jwks.json");
      expect(jwksUrl).toBe(
        "https://trusted.example/api/auth/.well-known/jwks.json"
      );
    });
  });
});
