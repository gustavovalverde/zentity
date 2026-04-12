/**
 * Tests for WebAuthn PRF module.
 * Tests client-side WebAuthn PRF support detection and helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bytesToBase64Url } from "@/lib/privacy/primitives/base64";

// We'll dynamically import to test with different global configurations
let checkPrfSupport: typeof import("../webauthn-prf").checkPrfSupport;
let extractPrfOutputFromClientResults: typeof import("../webauthn-prf").extractPrfOutputFromClientResults;

describe("webauthn-prf", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up global mocks
    if ("PublicKeyCredential" in globalThis) {
      // @ts-expect-error - cleaning up mock
      globalThis.PublicKeyCredential = undefined;
    }
  });

  describe("checkPrfSupport", () => {
    it("returns unsupported when PublicKeyCredential is not available", async () => {
      // Ensure PublicKeyCredential is not defined
      // @ts-expect-error - testing undefined
      globalThis.PublicKeyCredential = undefined;

      const module = await import("../webauthn-prf");
      checkPrfSupport = module.checkPrfSupport;

      const result = await checkPrfSupport();

      expect(result.supported).toBe(false);
      expect(result.reason).toBe("WebAuthn is not available.");
    });

    it("detects PRF support via getClientCapabilities with extension:prf=true", async () => {
      const mockGetClientCapabilities = vi.fn().mockResolvedValue({
        "extension:prf": true,
      });

      globalThis.PublicKeyCredential = {
        getClientCapabilities: mockGetClientCapabilities,
      } as unknown as typeof PublicKeyCredential;

      const module = await import("../webauthn-prf");
      checkPrfSupport = module.checkPrfSupport;

      const result = await checkPrfSupport();

      expect(result.supported).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("detects PRF unsupported via getClientCapabilities with extension:prf=false", async () => {
      const mockGetClientCapabilities = vi.fn().mockResolvedValue({
        "extension:prf": false,
      });

      globalThis.PublicKeyCredential = {
        getClientCapabilities: mockGetClientCapabilities,
      } as unknown as typeof PublicKeyCredential;

      const module = await import("../webauthn-prf");
      checkPrfSupport = module.checkPrfSupport;

      const result = await checkPrfSupport();

      expect(result.supported).toBe(false);
      expect(result.reason).toBe("PRF extension not supported.");
    });

    it("detects PRF support via getClientCapabilities with prf=true directly", async () => {
      const mockGetClientCapabilities = vi.fn().mockResolvedValue({
        prf: true,
      });

      globalThis.PublicKeyCredential = {
        getClientCapabilities: mockGetClientCapabilities,
      } as unknown as typeof PublicKeyCredential;

      const module = await import("../webauthn-prf");
      checkPrfSupport = module.checkPrfSupport;

      const result = await checkPrfSupport();

      expect(result.supported).toBe(true);
    });

    it("detects PRF support via extensions array containing prf", async () => {
      const mockGetClientCapabilities = vi.fn().mockResolvedValue({
        extensions: ["prf", "largeBlob"],
      });

      globalThis.PublicKeyCredential = {
        getClientCapabilities: mockGetClientCapabilities,
      } as unknown as typeof PublicKeyCredential;

      const module = await import("../webauthn-prf");
      checkPrfSupport = module.checkPrfSupport;

      const result = await checkPrfSupport();

      expect(result.supported).toBe(true);
    });

    it("detects PRF unsupported when extensions array exists without prf", async () => {
      const mockGetClientCapabilities = vi.fn().mockResolvedValue({
        extensions: ["largeBlob", "minPinLength"],
      });

      globalThis.PublicKeyCredential = {
        getClientCapabilities: mockGetClientCapabilities,
      } as unknown as typeof PublicKeyCredential;

      const module = await import("../webauthn-prf");
      checkPrfSupport = module.checkPrfSupport;

      const result = await checkPrfSupport();

      expect(result.supported).toBe(false);
      expect(result.reason).toBe("PRF extension not supported.");
    });

    it("falls back to assuming supported when getClientCapabilities is unavailable", async () => {
      globalThis.PublicKeyCredential =
        {} as unknown as typeof PublicKeyCredential;

      const module = await import("../webauthn-prf");
      checkPrfSupport = module.checkPrfSupport;

      const result = await checkPrfSupport();

      expect(result.supported).toBe(true);
    });

    it("falls back to assuming supported when getClientCapabilities throws", async () => {
      const mockGetClientCapabilities = vi
        .fn()
        .mockRejectedValue(new Error("Not implemented"));

      globalThis.PublicKeyCredential = {
        getClientCapabilities: mockGetClientCapabilities,
      } as unknown as typeof PublicKeyCredential;

      const module = await import("../webauthn-prf");
      checkPrfSupport = module.checkPrfSupport;

      const result = await checkPrfSupport();

      expect(result.supported).toBe(true);
    });

    it("tries public-key hint when initial getClientCapabilities fails", async () => {
      const mockGetClientCapabilities = vi
        .fn()
        .mockRejectedValueOnce(new Error("First call failed"))
        .mockResolvedValueOnce({ "extension:prf": true });

      globalThis.PublicKeyCredential = {
        getClientCapabilities: mockGetClientCapabilities,
      } as unknown as typeof PublicKeyCredential;

      const module = await import("../webauthn-prf");
      checkPrfSupport = module.checkPrfSupport;

      const result = await checkPrfSupport();

      expect(mockGetClientCapabilities).toHaveBeenCalledTimes(2);
      expect(mockGetClientCapabilities).toHaveBeenNthCalledWith(1);
      expect(mockGetClientCapabilities).toHaveBeenNthCalledWith(
        2,
        "public-key"
      );
      expect(result.supported).toBe(true);
    });
  });

  describe("extractPrfOutputFromClientResults", () => {
    it("returns null when no extension results", async () => {
      const module = await import("../webauthn-prf");
      extractPrfOutputFromClientResults =
        module.extractPrfOutputFromClientResults;

      const result = extractPrfOutputFromClientResults({
        clientExtensionResults: null,
        credentialId: "cred",
      });

      expect(result).toBeNull();
    });

    it("parses PRF output from ArrayBuffer", async () => {
      const module = await import("../webauthn-prf");
      extractPrfOutputFromClientResults =
        module.extractPrfOutputFromClientResults;

      const output = new Uint8Array(32).map((_, idx) => idx);
      const result = extractPrfOutputFromClientResults({
        clientExtensionResults: {
          prf: { results: { first: output.buffer } },
        },
        credentialId: "cred",
      });

      expect(result).toEqual(output);
    });

    it("parses PRF output from resultsByCredential base64url", async () => {
      const module = await import("../webauthn-prf");
      extractPrfOutputFromClientResults =
        module.extractPrfOutputFromClientResults;

      const output = new Uint8Array(32).map((_, idx) => 255 - idx);
      const encoded = bytesToBase64Url(output);

      const result = extractPrfOutputFromClientResults({
        clientExtensionResults: {
          prf: { resultsByCredential: { cred: encoded } },
        },
        credentialId: "cred",
      });

      expect(result).toEqual(output);
    });
  });
});
