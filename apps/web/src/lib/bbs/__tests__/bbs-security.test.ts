/**
 * BBS+ Security Tests
 *
 * Critical security validation for BBS+ credentials:
 * - Signature tampering detection
 * - Proof tampering detection
 * - Cross-key verification rejection
 * - Hidden claim confidentiality
 * - Unlinkability verification
 */

import type { WalletIdentitySubject } from "../types";

import { describe, expect, it } from "vitest";

import { createPresentation } from "../holder";
import { generateBbsKeyPair } from "../keygen";
import {
  createWalletCredential,
  subjectToMessages,
  verifyCredential,
  verifySignature,
} from "../signer";
import { verifyPresentation, verifyProof } from "../verifier";

describe("BBS+ Security", () => {
  describe("signature tampering", () => {
    it("rejects credential with tampered subject claim", async () => {
      const keyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xoriginal",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      // Tamper with tier
      credential.subject.tier = 99;

      const isValid = await verifyCredential(credential);
      expect(isValid).toBe(false);
    });

    it("rejects credential with tampered network claim", async () => {
      const keyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      // Tamper with network
      credential.subject.network = "polygon";

      expect(await verifyCredential(credential)).toBe(false);
    });

    it("rejects credential with tampered wallet commitment", async () => {
      const keyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xlegitimate",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 3,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      // Tamper with wallet commitment
      credential.subject.walletCommitment = "0xattacker";

      expect(await verifyCredential(credential)).toBe(false);
    });

    it("rejects credential with tampered signature bytes", async () => {
      const keyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      // Tamper with signature bytes
      // biome-ignore lint/suspicious/noBitwiseOperators: Intentional bit flip for tampering test
      credential.signature.signature[0] ^= 0xff;

      expect(await verifyCredential(credential)).toBe(false);
    });
  });

  describe("cross-key verification", () => {
    it("rejects credential verified with wrong issuer key", async () => {
      const issuerKeyPairA = await generateBbsKeyPair();
      const issuerKeyPairB = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      // Sign with issuer A
      const credential = await createWalletCredential(
        subject,
        issuerKeyPairA,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      // Replace public key with issuer B's key
      credential.issuerPublicKey = issuerKeyPairB.publicKey;

      expect(await verifyCredential(credential)).toBe(false);
    });

    it("rejects direct signature verification with wrong public key", async () => {
      const issuerKeyPairA = await generateBbsKeyPair();
      const issuerKeyPairB = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPairA,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      const messages = subjectToMessages(subject);

      // Verify with wrong key
      const isValid = await verifySignature(
        credential.signature,
        messages,
        issuerKeyPairB.publicKey
      );

      expect(isValid).toBe(false);
    });
  });

  describe("proof tampering", () => {
    it("rejects presentation with tampered proof bytes", async () => {
      const keyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xsecret",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      const presentation = await createPresentation(
        credential,
        ["network", "tier"],
        "verifier-nonce"
      );

      // Tamper with proof bytes
      // biome-ignore lint/suspicious/noBitwiseOperators: Intentional bit flip for tampering test
      presentation.proof.proof[0] ^= 0xff;

      const result = await verifyPresentation(presentation);
      expect(result.verified).toBe(false);
    });

    it("rejects presentation with wrong presentation header", async () => {
      const keyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xtest",
        network: "polygon",
        chainId: 137,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 3,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      const presentation = await createPresentation(
        credential,
        ["network"],
        "original-nonce"
      );

      // Tamper with presentation header (verifier binding)
      const encoder = new TextEncoder();
      presentation.proof.presentationHeader = encoder.encode("different-nonce");

      const result = await verifyPresentation(presentation);
      expect(result.verified).toBe(false);
    });

    it("rejects proof with mismatched revealed indices and messages count", async () => {
      const keyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      const presentation = await createPresentation(
        credential,
        ["network", "tier"],
        "nonce"
      );

      // Corrupt: add extra revealed index
      presentation.proof.revealedIndices.push(99);

      const result = await verifyPresentation(presentation);
      expect(result.verified).toBe(false);
      expect(result.error).toContain("Mismatch");
    });

    it("rejects proof with out-of-bounds message index", async () => {
      const keyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      const presentation = await createPresentation(
        credential,
        ["network"],
        "nonce"
      );

      // Corrupt: replace index with out-of-bounds value
      presentation.proof.revealedIndices[0] = 100;

      const result = await verifyProof(
        presentation.proof,
        presentation.issuerPublicKey,
        presentation.header
      );

      expect(result.verified).toBe(false);
      expect(result.error).toContain("Invalid message index");
    });
  });

  describe("hidden claim confidentiality", () => {
    it("hidden claims are not leaked in revealed claims object", async () => {
      const keyPair = await generateBbsKeyPair();

      const sensitiveCommitment = "0xvery_secret_wallet_commitment_12345";
      const subject: WalletIdentitySubject = {
        walletCommitment: sensitiveCommitment,
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 3,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      // Reveal only non-sensitive claims
      const presentation = await createPresentation(
        credential,
        ["network", "tier"],
        "nonce"
      );

      // Hidden claims must not appear in revealed claims
      expect(presentation.revealedClaims.walletCommitment).toBeUndefined();
      expect(presentation.revealedClaims.verifiedAt).toBeUndefined();
      expect(presentation.revealedClaims.chainId).toBeUndefined();

      // Ensure only requested claims are revealed
      expect(Object.keys(presentation.revealedClaims)).toEqual([
        "network",
        "tier",
      ]);

      // Verify the presentation still validates
      expect((await verifyPresentation(presentation)).verified).toBe(true);
    });

    it("hidden claims are not leaked in revealed messages array", async () => {
      const keyPair = await generateBbsKeyPair();

      const sensitiveCommitment = "0xsuper_secret_123456789";
      const subject: WalletIdentitySubject = {
        walletCommitment: sensitiveCommitment,
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      const presentation = await createPresentation(
        credential,
        ["network"],
        "nonce"
      );

      // Check revealed messages don't contain the secret
      const decoder = new TextDecoder();
      for (const msg of presentation.proof.revealedMessages) {
        const decoded = decoder.decode(msg);
        expect(decoded).not.toContain(sensitiveCommitment);
      }

      // Only index 1 (network) should be revealed
      expect(presentation.proof.revealedIndices).toEqual([1]);
    });
  });

  describe("unlinkability", () => {
    it("same credential produces cryptographically different proofs with different nonces", async () => {
      const keyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xfixed_commitment",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      // Same disclosure, different nonces
      const presentation1 = await createPresentation(
        credential,
        ["network"],
        "verifier-A-nonce"
      );
      const presentation2 = await createPresentation(
        credential,
        ["network"],
        "verifier-B-nonce"
      );

      // Both verify
      expect((await verifyPresentation(presentation1)).verified).toBe(true);
      expect((await verifyPresentation(presentation2)).verified).toBe(true);

      // Proofs are different (unlinkable)
      const proof1 = Buffer.from(presentation1.proof.proof).toString("hex");
      const proof2 = Buffer.from(presentation2.proof.proof).toString("hex");
      expect(proof1).not.toBe(proof2);

      // Presentation headers are different
      expect(
        Buffer.from(presentation1.proof.presentationHeader ?? []).toString()
      ).not.toBe(
        Buffer.from(presentation2.proof.presentationHeader ?? []).toString()
      );
    });

    it("proofs from same credential are unlinkable to verifiers", async () => {
      const keyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xuser_identity",
        network: "polygon",
        chainId: 137,
        verifiedAt: "2024-06-01T00:00:00Z",
        tier: 3,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      // Multiple presentations to different verifiers
      const presentations = await Promise.all([
        createPresentation(credential, ["tier"], "verifier-1"),
        createPresentation(credential, ["tier"], "verifier-2"),
        createPresentation(credential, ["tier"], "verifier-3"),
      ]);

      // All verify
      for (const p of presentations) {
        expect((await verifyPresentation(p)).verified).toBe(true);
      }

      // All proofs are different
      const proofHexes = presentations.map((p) =>
        Buffer.from(p.proof.proof).toString("hex")
      );
      const uniqueProofs = new Set(proofHexes);
      expect(uniqueProofs.size).toBe(3);
    });

    it("reveals same data but with different proof bytes", async () => {
      const keyPair = await generateBbsKeyPair();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xconstant",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        keyPair,
        "did:web:zentity.xyz",
        "did:key:holder"
      );

      const p1 = await createPresentation(credential, ["tier"], "nonce-A");
      const p2 = await createPresentation(credential, ["tier"], "nonce-B");

      // Same revealed data
      expect(p1.revealedClaims.tier).toBe(p2.revealedClaims.tier);
      expect(p1.revealedClaims.tier).toBe(2);

      // Different proof bytes (unlinkable)
      expect(Buffer.from(p1.proof.proof).toString("hex")).not.toBe(
        Buffer.from(p2.proof.proof).toString("hex")
      );
    });
  });
});
