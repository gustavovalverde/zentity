import { describe, expect, it } from "vitest";

import { AuthMode } from "@/lib/privacy/zk/proof-types";

import {
  type BindingSecretResult,
  bytesToFieldHex,
  deriveBindingSecret,
  prepareBindingProofInputs,
} from "../binding-secret";

describe("binding-secret", () => {
  describe("bytesToFieldHex", () => {
    it("converts bytes to 0x-prefixed hex", () => {
      const bytes = new Uint8Array([0x12, 0x34, 0xab, 0xcd]);
      expect(bytesToFieldHex(bytes)).toBe("0x1234abcd");
    });

    it("pads single-digit hex values", () => {
      const bytes = new Uint8Array([0x01, 0x02, 0x03]);
      expect(bytesToFieldHex(bytes)).toBe("0x010203");
    });

    it("handles empty array", () => {
      const bytes = new Uint8Array([]);
      expect(bytesToFieldHex(bytes)).toBe("0x");
    });
  });

  describe("deriveBindingSecret", () => {
    const mockUserId = "user-123";
    const mockDocumentHash = "0xdeadbeef1234567890abcdef";

    describe("passkey binding", () => {
      it("derives binding secret from PRF output", async () => {
        const prfOutput = crypto.getRandomValues(new Uint8Array(32));

        const result = await deriveBindingSecret({
          authMode: AuthMode.PASSKEY,
          prfOutput,
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        expect(result.bindingSecret).toHaveLength(32);
        expect(result.userIdHash).toHaveLength(32);
        expect(result.authModeNumeric).toBe(0);
      });

      it("produces deterministic output for same input", async () => {
        const prfOutput = new Uint8Array(32).fill(42);

        const result1 = await deriveBindingSecret({
          authMode: AuthMode.PASSKEY,
          prfOutput,
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        const result2 = await deriveBindingSecret({
          authMode: AuthMode.PASSKEY,
          prfOutput,
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        expect(bytesToFieldHex(result1.bindingSecret)).toBe(
          bytesToFieldHex(result2.bindingSecret)
        );
        expect(bytesToFieldHex(result1.userIdHash)).toBe(
          bytesToFieldHex(result2.userIdHash)
        );
      });

      it("produces different output for different PRF", async () => {
        const prfOutput1 = new Uint8Array(32).fill(1);
        const prfOutput2 = new Uint8Array(32).fill(2);

        const result1 = await deriveBindingSecret({
          authMode: AuthMode.PASSKEY,
          prfOutput: prfOutput1,
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        const result2 = await deriveBindingSecret({
          authMode: AuthMode.PASSKEY,
          prfOutput: prfOutput2,
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        expect(bytesToFieldHex(result1.bindingSecret)).not.toBe(
          bytesToFieldHex(result2.bindingSecret)
        );
      });
    });

    describe("OPAQUE binding", () => {
      it("derives binding secret from export key", async () => {
        const exportKey = crypto.getRandomValues(new Uint8Array(64));

        const result = await deriveBindingSecret({
          authMode: AuthMode.OPAQUE,
          exportKey,
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        expect(result.bindingSecret).toHaveLength(32);
        expect(result.userIdHash).toHaveLength(32);
        expect(result.authModeNumeric).toBe(1);
      });

      it("produces deterministic output for same input", async () => {
        const exportKey = new Uint8Array(64).fill(99);

        const result1 = await deriveBindingSecret({
          authMode: AuthMode.OPAQUE,
          exportKey,
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        const result2 = await deriveBindingSecret({
          authMode: AuthMode.OPAQUE,
          exportKey,
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        expect(bytesToFieldHex(result1.bindingSecret)).toBe(
          bytesToFieldHex(result2.bindingSecret)
        );
      });
    });

    describe("wallet binding", () => {
      it("derives binding secret from signature", async () => {
        const signatureBytes = crypto.getRandomValues(new Uint8Array(65));
        const walletAddress = "0x1234567890123456789012345678901234567890";
        const chainId = 1;

        const result = await deriveBindingSecret({
          authMode: AuthMode.WALLET,
          signatureBytes,
          walletAddress,
          chainId,
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        expect(result.bindingSecret).toHaveLength(32);
        expect(result.userIdHash).toHaveLength(32);
        expect(result.authModeNumeric).toBe(2);
      });

      it("produces different output for different users with same signature", async () => {
        const signatureBytes = new Uint8Array(65).fill(77);
        const walletAddress = "0x1234567890123456789012345678901234567890";
        const chainId = 1;

        const result1 = await deriveBindingSecret({
          authMode: AuthMode.WALLET,
          signatureBytes,
          walletAddress,
          chainId,
          userId: "user-1",
          documentHash: mockDocumentHash,
        });

        const result2 = await deriveBindingSecret({
          authMode: AuthMode.WALLET,
          signatureBytes,
          walletAddress,
          chainId,
          userId: "user-2",
          documentHash: mockDocumentHash,
        });

        // Binding secrets should differ (userId is in HKDF salt)
        expect(bytesToFieldHex(result1.bindingSecret)).not.toBe(
          bytesToFieldHex(result2.bindingSecret)
        );
        // User ID hashes should also differ
        expect(bytesToFieldHex(result1.userIdHash)).not.toBe(
          bytesToFieldHex(result2.userIdHash)
        );
      });
    });

    describe("cross-auth-mode isolation", () => {
      it("produces different secrets for same material with different auth modes", async () => {
        // Use same byte pattern for all modes to verify domain separation
        const material = new Uint8Array(64).fill(55);

        const passkeyResult = await deriveBindingSecret({
          authMode: AuthMode.PASSKEY,
          prfOutput: material.slice(0, 32),
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        const opaqueResult = await deriveBindingSecret({
          authMode: AuthMode.OPAQUE,
          exportKey: material,
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        const walletResult = await deriveBindingSecret({
          authMode: AuthMode.WALLET,
          signatureBytes: material.slice(0, 65),
          walletAddress: "0x1234567890123456789012345678901234567890",
          chainId: 1,
          userId: mockUserId,
          documentHash: mockDocumentHash,
        });

        // All binding secrets should be different due to different HKDF info strings
        const secrets = [
          bytesToFieldHex(passkeyResult.bindingSecret),
          bytesToFieldHex(opaqueResult.bindingSecret),
          bytesToFieldHex(walletResult.bindingSecret),
        ];

        expect(new Set(secrets).size).toBe(3);
      });
    });
  });

  describe("prepareBindingProofInputs", () => {
    it("formats binding secret result for Noir circuit", () => {
      const mockResult: BindingSecretResult = {
        bindingSecret: new Uint8Array([0x12, 0x34, 0x56, 0x78]),
        userIdHash: new Uint8Array([0xab, 0xcd, 0xef, 0x01]),
        documentHashBytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        authModeNumeric: 1,
      };

      const inputs = prepareBindingProofInputs(mockResult);

      expect(inputs.bindingSecretField).toBe("0x12345678");
      expect(inputs.userIdHashField).toBe("0xabcdef01");
      expect(inputs.documentHashField).toBe("0xdeadbeef");
      expect(inputs.authModeField).toBe("1");
    });

    it("handles all auth modes", () => {
      for (const authMode of [0, 1, 2] as const) {
        const mockResult: BindingSecretResult = {
          bindingSecret: new Uint8Array(32),
          userIdHash: new Uint8Array(32),
          documentHashBytes: new Uint8Array(16),
          authModeNumeric: authMode,
        };

        const inputs = prepareBindingProofInputs(mockResult);
        expect(inputs.authModeField).toBe(authMode.toString());
      }
    });
  });
});
