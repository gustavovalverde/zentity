/**
 * Tests for WebAuthn PRF module.
 * Tests client-side WebAuthn PRF support detection and helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We'll dynamically import to test with different global configurations
let checkPrfSupport: typeof import("../webauthn-prf").checkPrfSupport;
let extractCredentialRegistrationData: typeof import("../webauthn-prf").extractCredentialRegistrationData;

describe("webauthn-prf", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up global mocks
    if ("PublicKeyCredential" in globalThis) {
      // @ts-expect-error - cleaning up mock
      delete globalThis.PublicKeyCredential;
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
        "public-key",
      );
      expect(result.supported).toBe(true);
    });
  });

  describe("extractCredentialRegistrationData", () => {
    it("extracts COSE public key from credential", async () => {
      const module = await import("../webauthn-prf");
      extractCredentialRegistrationData =
        module.extractCredentialRegistrationData;

      const mockPublicKey = new Uint8Array([1, 2, 3, 4, 5]);
      const mockAuthData = createMockAuthenticatorData({
        rpIdHash: new Uint8Array(32).fill(0xaa),
        flags: 0x45, // UP=1, UV=1, BE=0, BS=0
        counter: 42,
      });

      const mockCredential = createMockCredential({
        rawId: new Uint8Array([10, 20, 30, 40]),
        publicKey: mockPublicKey,
        authenticatorData: mockAuthData,
        transports: ["internal", "hybrid"],
        authenticatorAttachment: "platform",
      });

      const result = extractCredentialRegistrationData(mockCredential);

      expect(result.credentialId).toBeDefined();
      expect(result.publicKey).toBeDefined();
      expect(result.counter).toBe(42);
      expect(result.deviceType).toBe("platform");
      expect(result.backedUp).toBe(false);
      expect(result.transports).toEqual(["internal", "hybrid"]);
    });

    it("extracts backedUp flag when set", async () => {
      const module = await import("../webauthn-prf");
      extractCredentialRegistrationData =
        module.extractCredentialRegistrationData;

      const mockAuthData = createMockAuthenticatorData({
        rpIdHash: new Uint8Array(32).fill(0xaa),
        flags: 0x55, // UP=1, UV=1, BE=1, BS=1 (backed up)
        counter: 0,
      });

      const mockCredential = createMockCredential({
        rawId: new Uint8Array([10]),
        publicKey: new Uint8Array([1]),
        authenticatorData: mockAuthData,
        authenticatorAttachment: null,
      });

      const result = extractCredentialRegistrationData(mockCredential);

      expect(result.backedUp).toBe(true);
    });

    it("extracts cross-platform device type", async () => {
      const module = await import("../webauthn-prf");
      extractCredentialRegistrationData =
        module.extractCredentialRegistrationData;

      const mockAuthData = createMockAuthenticatorData({
        rpIdHash: new Uint8Array(32).fill(0xaa),
        flags: 0x01,
        counter: 0,
      });

      const mockCredential = createMockCredential({
        rawId: new Uint8Array([10]),
        publicKey: new Uint8Array([1]),
        authenticatorData: mockAuthData,
        authenticatorAttachment: "cross-platform",
      });

      const result = extractCredentialRegistrationData(mockCredential);

      expect(result.deviceType).toBe("cross-platform");
    });

    it("returns null deviceType for unknown attachment", async () => {
      const module = await import("../webauthn-prf");
      extractCredentialRegistrationData =
        module.extractCredentialRegistrationData;

      const mockAuthData = createMockAuthenticatorData({
        rpIdHash: new Uint8Array(32).fill(0xaa),
        flags: 0x01,
        counter: 0,
      });

      const mockCredential = createMockCredential({
        rawId: new Uint8Array([10]),
        publicKey: new Uint8Array([1]),
        authenticatorData: mockAuthData,
        authenticatorAttachment: null,
      });

      const result = extractCredentialRegistrationData(mockCredential);

      expect(result.deviceType).toBeNull();
    });

    it("THROWS when getPublicKey is unavailable", async () => {
      const module = await import("../webauthn-prf");
      extractCredentialRegistrationData =
        module.extractCredentialRegistrationData;

      const mockAuthData = createMockAuthenticatorData({
        rpIdHash: new Uint8Array(32).fill(0xaa),
        flags: 0x01,
        counter: 0,
      });

      const mockCredential = createMockCredential({
        rawId: new Uint8Array([10]),
        publicKey: null, // No public key available
        authenticatorData: mockAuthData,
        authenticatorAttachment: null,
      });

      expect(() => extractCredentialRegistrationData(mockCredential)).toThrow(
        "Unable to extract public key from credential.",
      );
    });

    it("extracts counter from big-endian bytes", async () => {
      const module = await import("../webauthn-prf");
      extractCredentialRegistrationData =
        module.extractCredentialRegistrationData;

      // Counter = 0x01020304 = 16909060 in decimal
      const mockAuthData = createMockAuthenticatorData({
        rpIdHash: new Uint8Array(32).fill(0xaa),
        flags: 0x01,
        counter: 16909060,
      });

      const mockCredential = createMockCredential({
        rawId: new Uint8Array([10]),
        publicKey: new Uint8Array([1]),
        authenticatorData: mockAuthData,
        authenticatorAttachment: null,
      });

      const result = extractCredentialRegistrationData(mockCredential);

      expect(result.counter).toBe(16909060);
    });

    it("handles empty transports array", async () => {
      const module = await import("../webauthn-prf");
      extractCredentialRegistrationData =
        module.extractCredentialRegistrationData;

      const mockAuthData = createMockAuthenticatorData({
        rpIdHash: new Uint8Array(32).fill(0xaa),
        flags: 0x01,
        counter: 0,
      });

      const mockCredential = createMockCredential({
        rawId: new Uint8Array([10]),
        publicKey: new Uint8Array([1]),
        authenticatorData: mockAuthData,
        authenticatorAttachment: null,
        transports: undefined,
      });

      const result = extractCredentialRegistrationData(mockCredential);

      expect(result.transports).toEqual([]);
    });
  });
});

/**
 * Create mock authenticator data bytes.
 */
function createMockAuthenticatorData(params: {
  rpIdHash: Uint8Array;
  flags: number;
  counter: number;
}): Uint8Array {
  const data = new Uint8Array(37);
  data.set(params.rpIdHash, 0);
  data[32] = params.flags;
  // Counter as big-endian 32-bit
  const view = new DataView(data.buffer, 33, 4);
  view.setUint32(0, params.counter, false);
  return data;
}

/**
 * Create mock PublicKeyCredential for testing.
 */
function createMockCredential(params: {
  rawId: Uint8Array;
  publicKey: Uint8Array | null;
  authenticatorData: Uint8Array;
  authenticatorAttachment?: string | null;
  transports?: string[];
}): PublicKeyCredential {
  const { publicKey } = params;
  return {
    rawId: params.rawId.buffer,
    authenticatorAttachment: params.authenticatorAttachment ?? null,
    response: {
      getPublicKey: publicKey ? () => publicKey.buffer : undefined,
      getAuthenticatorData: () => params.authenticatorData.buffer,
      getTransports: params.transports ? () => params.transports : undefined,
    },
    getClientExtensionResults: () => ({}),
  } as unknown as PublicKeyCredential;
}
