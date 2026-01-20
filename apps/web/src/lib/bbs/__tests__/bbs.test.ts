import type { WalletIdentitySubject } from "../types";

import { describe, expect, it } from "vitest";

import { BBS_PUBLIC_KEY_LENGTH, BBS_SECRET_KEY_LENGTH } from "../crypto";
import { createPresentation } from "../holder";
import {
  deriveBbsKeyPair,
  deserializeBbsKeyPair,
  generateBbsKeyPair,
  isValidBbsPublicKey,
  isValidBbsSecretKey,
  serializeBbsKeyPair,
} from "../keygen";
import { createWalletCredential, verifyCredential } from "../signer";
import { verifyPresentation } from "../verifier";

describe("BBS+ Module", () => {
  describe("keygen", () => {
    it("generates valid keypair with correct lengths", async () => {
      const keyPair = await generateBbsKeyPair();

      expect(keyPair.secretKey).toHaveLength(32);
      expect(keyPair.publicKey).toHaveLength(96);
    });

    it("produces deterministic keypair from same seed", async () => {
      const seed = new Uint8Array(32).fill(42);

      const keyPair1 = await deriveBbsKeyPair(seed, "test-context");
      const keyPair2 = await deriveBbsKeyPair(seed, "test-context");

      expect(Buffer.from(keyPair1.secretKey).toString("hex")).toBe(
        Buffer.from(keyPair2.secretKey).toString("hex")
      );
      expect(Buffer.from(keyPair1.publicKey).toString("hex")).toBe(
        Buffer.from(keyPair2.publicKey).toString("hex")
      );
    });

    it("produces different keypairs for different contexts", async () => {
      const seed = new Uint8Array(32).fill(42);

      const keyPair1 = await deriveBbsKeyPair(seed, "context-1");
      const keyPair2 = await deriveBbsKeyPair(seed, "context-2");

      expect(Buffer.from(keyPair1.secretKey).toString("hex")).not.toBe(
        Buffer.from(keyPair2.secretKey).toString("hex")
      );
    });

    it("serializes and deserializes keypair correctly", async () => {
      const original = await generateBbsKeyPair();
      const serialized = serializeBbsKeyPair(original);
      const deserialized = deserializeBbsKeyPair(serialized);

      expect(Buffer.from(deserialized.secretKey).toString("hex")).toBe(
        Buffer.from(original.secretKey).toString("hex")
      );
      expect(Buffer.from(deserialized.publicKey).toString("hex")).toBe(
        Buffer.from(original.publicKey).toString("hex")
      );
    });

    it("validates public key length correctly", async () => {
      const keyPair = await generateBbsKeyPair();
      expect(isValidBbsPublicKey(keyPair.publicKey)).toBe(true);
      expect(isValidBbsPublicKey(new Uint8Array(BBS_PUBLIC_KEY_LENGTH))).toBe(
        true
      );
      expect(isValidBbsPublicKey(new Uint8Array(95))).toBe(false);
      expect(isValidBbsPublicKey(new Uint8Array(97))).toBe(false);
      expect(isValidBbsPublicKey(new Uint8Array(0))).toBe(false);
    });

    it("validates secret key length correctly", async () => {
      const keyPair = await generateBbsKeyPair();
      expect(isValidBbsSecretKey(keyPair.secretKey)).toBe(true);
      expect(isValidBbsSecretKey(new Uint8Array(BBS_SECRET_KEY_LENGTH))).toBe(
        true
      );
      expect(isValidBbsSecretKey(new Uint8Array(31))).toBe(false);
      expect(isValidBbsSecretKey(new Uint8Array(33))).toBe(false);
      expect(isValidBbsSecretKey(new Uint8Array(0))).toBe(false);
    });

    it("rejects derivation with too short seed", async () => {
      const shortSeed = new Uint8Array(16);
      await expect(deriveBbsKeyPair(shortSeed, "context")).rejects.toThrow(
        "Seed must be at least 32 bytes"
      );
    });

    it("accepts seed longer than 32 bytes (truncated)", async () => {
      const longSeed = new Uint8Array(64).fill(99);
      const keyPair = await deriveBbsKeyPair(longSeed, "context");
      expect(keyPair.secretKey).toHaveLength(BBS_SECRET_KEY_LENGTH);
      expect(keyPair.publicKey).toHaveLength(BBS_PUBLIC_KEY_LENGTH);
    });
  });

  describe("signer - wallet credentials (RFC-0020)", () => {
    it("creates and verifies wallet credential", async () => {
      const issuerKeyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xabcdef1234567890",
        network: "ethereum",
        chainId: 1,
        verifiedAt: new Date().toISOString(),
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        "did:web:zentity.xyz",
        "did:key:z6Mk..."
      );

      expect(credential.format).toBe("bbs+vc");
      expect(credential.credentialType).toBe("wallet");
      expect(credential.issuer).toBe("did:web:zentity.xyz");
      expect(credential.holder).toBe("did:key:z6Mk...");
      expect(credential.subject).toEqual(subject);

      const isValid = await verifyCredential(credential);
      expect(isValid).toBe(true);
    });

    it("handles credential without optional chainId", async () => {
      const issuerKeyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xtest",
        network: "bitcoin",
        verifiedAt: new Date().toISOString(),
        tier: 1,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        "did:web:zentity.xyz",
        "did:key:z6Mk..."
      );

      expect(credential.credentialType).toBe("wallet");
      expect(credential.subject.chainId).toBeUndefined();
      expect(await verifyCredential(credential)).toBe(true);
    });

    it("produces deterministic signatures for same inputs (via fixed seed)", async () => {
      const seed = new Uint8Array(32).fill(7);
      const keyPair1 = await deriveBbsKeyPair(seed, "test");
      const keyPair2 = await deriveBbsKeyPair(seed, "test");

      const fixedDate = "2024-01-01T00:00:00.000Z";
      const subject: WalletIdentitySubject = {
        walletCommitment: "0xfixed",
        network: "ethereum",
        chainId: 1,
        verifiedAt: fixedDate,
        tier: 2,
      };

      const cred1 = await createWalletCredential(
        subject,
        keyPair1,
        "did:web:zentity.xyz",
        "did:key:holder"
      );
      const cred2 = await createWalletCredential(
        subject,
        keyPair2,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      // Both should verify
      expect(await verifyCredential(cred1)).toBe(true);
      expect(await verifyCredential(cred2)).toBe(true);
    });
  });

  describe("holder - wallet credentials", () => {
    it("derives selective disclosure proof", async () => {
      const issuerKeyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xsecret_wallet_commitment",
        network: "ethereum",
        chainId: 1,
        verifiedAt: new Date().toISOString(),
        tier: 3,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        "did:web:zentity.xyz",
        "did:key:z6Mk..."
      );

      // Create presentation revealing only network and tier (hiding wallet commitment)
      const presentation = await createPresentation(
        credential,
        ["network", "tier"],
        "verifier-nonce-123"
      );

      expect(presentation.format).toBe("bbs+vp");
      expect(presentation.credentialType).toBe("wallet");
      expect(presentation.revealedClaims.network).toBe("ethereum");
      expect(presentation.revealedClaims.tier).toBe(3);
      expect(presentation.revealedClaims.walletCommitment).toBeUndefined();
    });

    it("creates presentation revealing all claims", async () => {
      const issuerKeyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xall_revealed",
        network: "polygon",
        chainId: 137,
        verifiedAt: "2024-06-15T12:00:00Z",
        tier: 3,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      const presentation = await createPresentation(
        credential,
        ["walletCommitment", "network", "chainId", "verifiedAt", "tier"],
        "full-disclosure-context"
      );

      expect(presentation.credentialType).toBe("wallet");
      expect(presentation.revealedClaims.walletCommitment).toBe(
        "0xall_revealed"
      );
      expect(presentation.revealedClaims.network).toBe("polygon");
      expect(presentation.revealedClaims.chainId).toBe(137);
      expect(presentation.revealedClaims.verifiedAt).toBe(
        "2024-06-15T12:00:00Z"
      );
      expect(presentation.revealedClaims.tier).toBe(3);
      expect(presentation.proof.revealedIndices).toHaveLength(5);
    });

    it("creates presentation revealing no claims (zero-knowledge proof)", async () => {
      const issuerKeyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xsecret",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      const presentation = await createPresentation(
        credential,
        [],
        "zk-context"
      );

      expect(presentation.credentialType).toBe("wallet");
      expect(Object.keys(presentation.revealedClaims)).toHaveLength(0);
      expect(presentation.proof.revealedIndices).toHaveLength(0);
      expect(presentation.proof.revealedMessages).toHaveLength(0);

      const result = await verifyPresentation(presentation);
      expect(result.verified).toBe(true);
    });
  });

  describe("verifier", () => {
    it("verifies presentation with selective disclosure", async () => {
      const issuerKeyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xhidden_commitment",
        network: "polygon",
        chainId: 137,
        verifiedAt: "2024-01-15T10:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        "did:web:zentity.xyz",
        "did:key:z6Mk..."
      );

      const presentation = await createPresentation(
        credential,
        ["network", "verifiedAt"],
        "unique-verifier-nonce"
      );

      const result = await verifyPresentation(presentation);

      expect(result.verified).toBe(true);
      expect(presentation.revealedClaims.network).toBe("polygon");
      expect(presentation.revealedClaims.verifiedAt).toBe(
        "2024-01-15T10:00:00Z"
      );
      expect(presentation.revealedClaims.walletCommitment).toBeUndefined();
    });

    it("proves unlinkability - same credential produces different proofs", async () => {
      const issuerKeyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xfixed_commitment",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 1,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        "did:web:zentity.xyz",
        "did:key:z6Mk..."
      );

      // Same disclosure, different presentation contexts
      const presentation1 = await createPresentation(
        credential,
        ["network"],
        "nonce-1"
      );

      const presentation2 = await createPresentation(
        credential,
        ["network"],
        "nonce-2"
      );

      // Both should verify
      expect((await verifyPresentation(presentation1)).verified).toBe(true);
      expect((await verifyPresentation(presentation2)).verified).toBe(true);

      // But proofs should be different (unlinkable)
      const proof1Hex = Buffer.from(presentation1.proof.proof).toString("hex");
      const proof2Hex = Buffer.from(presentation2.proof.proof).toString("hex");
      expect(proof1Hex).not.toBe(proof2Hex);
    });
  });
});
