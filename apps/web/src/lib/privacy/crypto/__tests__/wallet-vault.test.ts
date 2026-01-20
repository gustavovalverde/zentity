import { describe, expect, it } from "vitest";

import {
  computeWalletCommitment,
  generateWalletCommitmentSalt,
  hexToWalletCommitment,
  verifyWalletCommitment,
  walletCommitmentToHex,
} from "../wallet-vault";

describe("wallet-vault commitment functions", () => {
  const testAddress = "0x1234567890123456789012345678901234567890";
  const testAddressNoPrefix = "1234567890123456789012345678901234567890";
  const testAddressUppercase = "0x1234567890123456789012345678901234567890";

  describe("generateWalletCommitmentSalt", () => {
    it("generates 32-byte salt", () => {
      const salt = generateWalletCommitmentSalt();
      expect(salt).toHaveLength(32);
      expect(salt).toBeInstanceOf(Uint8Array);
    });

    it("generates unique salts", () => {
      const salt1 = generateWalletCommitmentSalt();
      const salt2 = generateWalletCommitmentSalt();
      expect(walletCommitmentToHex(salt1)).not.toBe(
        walletCommitmentToHex(salt2)
      );
    });
  });

  describe("computeWalletCommitment", () => {
    it("produces 32-byte commitment", async () => {
      const salt = generateWalletCommitmentSalt();
      const commitment = await computeWalletCommitment(testAddress, salt);
      expect(commitment).toHaveLength(32);
      expect(commitment).toBeInstanceOf(Uint8Array);
    });

    it("is deterministic for same inputs", async () => {
      const salt = new Uint8Array(32).fill(42);
      const commitment1 = await computeWalletCommitment(testAddress, salt);
      const commitment2 = await computeWalletCommitment(testAddress, salt);
      expect(walletCommitmentToHex(commitment1)).toBe(
        walletCommitmentToHex(commitment2)
      );
    });

    it("normalizes address format (with/without 0x prefix)", async () => {
      const salt = new Uint8Array(32).fill(1);
      const commitment1 = await computeWalletCommitment(testAddress, salt);
      const commitment2 = await computeWalletCommitment(
        testAddressNoPrefix,
        salt
      );
      expect(walletCommitmentToHex(commitment1)).toBe(
        walletCommitmentToHex(commitment2)
      );
    });

    it("normalizes address case", async () => {
      const salt = new Uint8Array(32).fill(2);
      const commitment1 = await computeWalletCommitment(testAddress, salt);
      const commitment2 = await computeWalletCommitment(
        testAddressUppercase.toUpperCase(),
        salt
      );
      expect(walletCommitmentToHex(commitment1)).toBe(
        walletCommitmentToHex(commitment2)
      );
    });

    it("produces different commitments for different salts", async () => {
      const salt1 = new Uint8Array(32).fill(1);
      const salt2 = new Uint8Array(32).fill(2);
      const commitment1 = await computeWalletCommitment(testAddress, salt1);
      const commitment2 = await computeWalletCommitment(testAddress, salt2);
      expect(walletCommitmentToHex(commitment1)).not.toBe(
        walletCommitmentToHex(commitment2)
      );
    });

    it("produces different commitments for different addresses", async () => {
      const salt = new Uint8Array(32).fill(99);
      const address2 = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
      const commitment1 = await computeWalletCommitment(testAddress, salt);
      const commitment2 = await computeWalletCommitment(address2, salt);
      expect(walletCommitmentToHex(commitment1)).not.toBe(
        walletCommitmentToHex(commitment2)
      );
    });
  });

  describe("verifyWalletCommitment", () => {
    it("returns true for valid commitment", async () => {
      const salt = generateWalletCommitmentSalt();
      const commitment = await computeWalletCommitment(testAddress, salt);
      const isValid = await verifyWalletCommitment(
        testAddress,
        salt,
        commitment
      );
      expect(isValid).toBe(true);
    });

    it("returns true regardless of address format", async () => {
      const salt = generateWalletCommitmentSalt();
      const commitment = await computeWalletCommitment(testAddress, salt);
      // Verify with different format (no 0x prefix)
      const isValid = await verifyWalletCommitment(
        testAddressNoPrefix,
        salt,
        commitment
      );
      expect(isValid).toBe(true);
    });

    it("returns false for wrong address", async () => {
      const salt = generateWalletCommitmentSalt();
      const commitment = await computeWalletCommitment(testAddress, salt);
      const wrongAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
      const isValid = await verifyWalletCommitment(
        wrongAddress,
        salt,
        commitment
      );
      expect(isValid).toBe(false);
    });

    it("returns false for wrong salt", async () => {
      const salt1 = new Uint8Array(32).fill(1);
      const salt2 = new Uint8Array(32).fill(2);
      const commitment = await computeWalletCommitment(testAddress, salt1);
      const isValid = await verifyWalletCommitment(
        testAddress,
        salt2,
        commitment
      );
      expect(isValid).toBe(false);
    });

    it("returns false for tampered commitment", async () => {
      const salt = generateWalletCommitmentSalt();
      const commitment = await computeWalletCommitment(testAddress, salt);
      // Tamper with commitment by flipping all bits in first byte
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional bit manipulation for test
      commitment[0] ^= 0xff;
      const isValid = await verifyWalletCommitment(
        testAddress,
        salt,
        commitment
      );
      expect(isValid).toBe(false);
    });

    it("returns false for wrong-length commitment", async () => {
      const salt = generateWalletCommitmentSalt();
      const shortCommitment = new Uint8Array(16);
      const isValid = await verifyWalletCommitment(
        testAddress,
        salt,
        shortCommitment
      );
      expect(isValid).toBe(false);
    });
  });

  describe("hex conversion", () => {
    it("round-trips commitment through hex", () => {
      const original = crypto.getRandomValues(new Uint8Array(32));
      const hex = walletCommitmentToHex(original);
      const recovered = hexToWalletCommitment(hex);
      expect(walletCommitmentToHex(recovered)).toBe(
        walletCommitmentToHex(original)
      );
    });

    it("handles 0x prefix in hexToWalletCommitment", () => {
      const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const hex = "0xdeadbeef";
      const recovered = hexToWalletCommitment(hex);
      expect(walletCommitmentToHex(recovered)).toBe(
        walletCommitmentToHex(original)
      );
    });

    it("handles lowercase hex", () => {
      const hex = "deadbeef";
      const recovered = hexToWalletCommitment(hex);
      expect(walletCommitmentToHex(recovered)).toBe(hex);
    });
  });
});
