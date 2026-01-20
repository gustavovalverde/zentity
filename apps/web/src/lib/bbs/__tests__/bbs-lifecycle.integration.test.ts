/**
 * BBS+ Credential Lifecycle Integration Tests
 *
 * Tests complete credential flows including:
 * - Issuer key management
 * - Credential issuance
 * - Selective disclosure presentations
 * - Multi-verifier scenarios
 * - Unlinkability guarantees
 */

import type { BbsCredential, WalletIdentitySubject } from "../types";

type WalletCredential = BbsCredential;

import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { createPresentation } from "../holder";
import {
  deriveBbsKeyPair,
  deserializeBbsKeyPair,
  generateBbsKeyPair,
  isValidBbsPublicKey,
  isValidBbsSecretKey,
  serializeBbsKeyPair,
} from "../keygen";
import {
  createWalletCredential,
  subjectToMessages,
  verifyCredential,
} from "../signer";
import { getRevealedClaim, verifyPresentation } from "../verifier";

/**
 * Helper: Compute wallet commitment (hash of address + salt)
 * In production, this would use Poseidon or SHA256
 */
function computeWalletCommitment(
  walletAddress: string,
  salt: Uint8Array
): string {
  const encoder = new TextEncoder();
  const addressBytes = encoder.encode(walletAddress.toLowerCase());
  const combined = new Uint8Array(addressBytes.length + salt.length);
  combined.set(addressBytes);
  combined.set(salt, addressBytes.length);
  const hash = crypto.createHash("sha256").update(combined).digest("hex");
  return `0x${hash}`;
}

describe("BBS+ Credential Lifecycle", () => {
  let issuerKeyPair: Awaited<ReturnType<typeof generateBbsKeyPair>>;
  let issuerDid: string;

  beforeEach(async () => {
    // Fresh issuer keypair for each test
    issuerKeyPair = await generateBbsKeyPair();
    issuerDid = "did:web:zentity.xyz";
  });

  describe("issuer key management", () => {
    it("generates deterministic issuer key from master secret", async () => {
      const masterSecret = crypto.getRandomValues(new Uint8Array(32));
      const context = "zentity-bbs-issuer-v1";

      const keyPair1 = await deriveBbsKeyPair(masterSecret, context);
      const keyPair2 = await deriveBbsKeyPair(masterSecret, context);

      expect(isValidBbsSecretKey(keyPair1.secretKey)).toBe(true);
      expect(isValidBbsPublicKey(keyPair1.publicKey)).toBe(true);
      expect(Buffer.from(keyPair1.secretKey).toString("hex")).toBe(
        Buffer.from(keyPair2.secretKey).toString("hex")
      );
    });

    it("securely stores and retrieves issuer keypair", async () => {
      // Simulate encrypted storage (would use passkey-wrapped encryption in prod)
      const serialized = serializeBbsKeyPair(issuerKeyPair);
      const encrypted = Buffer.from(serialized).toString("base64");

      // Later retrieval
      const decrypted = Buffer.from(encrypted, "base64").toString();
      const recovered = deserializeBbsKeyPair(decrypted);

      expect(isValidBbsSecretKey(recovered.secretKey)).toBe(true);
      expect(isValidBbsPublicKey(recovered.publicKey)).toBe(true);

      // Can sign and verify with recovered key
      const subject: WalletIdentitySubject = {
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        verifiedAt: new Date().toISOString(),
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        recovered,
        issuerDid,
        "did:key:holder"
      );

      expect(await verifyCredential(credential)).toBe(true);
    });
  });

  describe("complete issuance flow", () => {
    it("issues credential after wallet verification", async () => {
      // Step 1: User proves wallet ownership (simulated)
      const walletAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f1Ab23";
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const commitment = computeWalletCommitment(walletAddress, salt);

      // Step 2: After verification, issue credential
      const subject: WalletIdentitySubject = {
        walletCommitment: commitment,
        network: "ethereum",
        chainId: 1,
        verifiedAt: new Date().toISOString(),
        tier: 2,
      };

      const holderDid = `did:key:z6Mk${Buffer.from(
        crypto.getRandomValues(new Uint8Array(16))
      ).toString("hex")}`;

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        issuerDid,
        holderDid
      );

      // Step 3: Verify credential structure
      expect(credential.format).toBe("bbs+vc");
      expect(credential.issuer).toBe(issuerDid);
      expect(credential.holder).toBe(holderDid);
      expect(credential.subject.walletCommitment).toBe(commitment);
      expect(credential.signature.messageCount).toBe(5); // 5 claims

      // Step 4: Signature verification
      expect(await verifyCredential(credential)).toBe(true);
    });

    it("issues credentials for multiple networks", async () => {
      const walletAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f1Ab23";
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const commitment = computeWalletCommitment(walletAddress, salt);
      const holderDid = "did:key:holder123";
      const verifiedAt = new Date().toISOString();

      const networks = [
        { network: "ethereum", chainId: 1 },
        { network: "polygon", chainId: 137 },
        { network: "arbitrum", chainId: 42_161 },
      ];

      const credentials: WalletCredential[] = [];

      for (const { network, chainId } of networks) {
        const subject: WalletIdentitySubject = {
          walletCommitment: commitment,
          network,
          chainId,
          verifiedAt,
          tier: 2,
        };

        const credential = await createWalletCredential(
          subject,
          issuerKeyPair,
          issuerDid,
          holderDid
        );

        expect(await verifyCredential(credential)).toBe(true);
        credentials.push(credential);
      }

      expect(credentials).toHaveLength(3);
    });
  });

  describe("selective disclosure presentations", () => {
    let credential: WalletCredential;
    let holderDid: string;

    beforeEach(async () => {
      const walletAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f1Ab23";
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const commitment = computeWalletCommitment(walletAddress, salt);
      holderDid = "did:key:z6MkHolder";

      const subject: WalletIdentitySubject = {
        walletCommitment: commitment,
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-06-15T10:00:00Z",
        tier: 3,
      };

      credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        issuerDid,
        holderDid
      );
    });

    it("reveals only tier for DeFi access check", async () => {
      // DeFi protocol only needs to know tier
      const presentation = await createPresentation(
        credential,
        ["tier"],
        "defi-protocol-nonce-12345"
      );

      const result = await verifyPresentation(presentation);
      expect(result.verified).toBe(true);

      // Only tier revealed
      expect(presentation.revealedClaims.tier).toBe(3);
      expect(presentation.revealedClaims.walletCommitment).toBeUndefined();
      expect(presentation.revealedClaims.network).toBeUndefined();
    });

    it("reveals network and tier for cross-chain bridge", async () => {
      // Bridge needs network and tier
      const presentation = await createPresentation(
        credential,
        ["network", "chainId", "tier"],
        "bridge-verification-nonce"
      );

      const result = await verifyPresentation(presentation);
      expect(result.verified).toBe(true);

      expect(presentation.revealedClaims.network).toBe("ethereum");
      expect(presentation.revealedClaims.chainId).toBe(1);
      expect(presentation.revealedClaims.tier).toBe(3);
      expect(presentation.revealedClaims.walletCommitment).toBeUndefined();
    });

    it("reveals nothing for privacy-preserving compliance check", async () => {
      // Just prove credential exists without revealing anything
      const presentation = await createPresentation(
        credential,
        [],
        "compliance-check-nonce"
      );

      const result = await verifyPresentation(presentation);
      expect(result.verified).toBe(true);

      expect(Object.keys(presentation.revealedClaims)).toHaveLength(0);
    });

    it("reveals all for full audit", async () => {
      // Regulatory audit requires full disclosure
      const presentation = await createPresentation(
        credential,
        ["walletCommitment", "network", "chainId", "verifiedAt", "tier"],
        "audit-request-nonce"
      );

      const result = await verifyPresentation(presentation);
      expect(result.verified).toBe(true);

      expect(Object.keys(presentation.revealedClaims)).toHaveLength(5);
    });
  });

  describe("multi-verifier scenarios", () => {
    it("same credential works with multiple verifiers", async () => {
      const subject: WalletIdentitySubject = {
        walletCommitment: "0xuser_commitment",
        network: "polygon",
        chainId: 137,
        verifiedAt: new Date().toISOString(),
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        issuerDid,
        "did:key:holder"
      );

      // Verifier A: DEX
      const presentationA = await createPresentation(
        credential,
        ["tier"],
        "dex-nonce-abc"
      );
      expect((await verifyPresentation(presentationA)).verified).toBe(true);

      // Verifier B: Lending protocol
      const presentationB = await createPresentation(
        credential,
        ["tier", "network"],
        "lending-nonce-xyz"
      );
      expect((await verifyPresentation(presentationB)).verified).toBe(true);

      // Verifier C: NFT marketplace
      const presentationC = await createPresentation(
        credential,
        ["verifiedAt"],
        "nft-nonce-123"
      );
      expect((await verifyPresentation(presentationC)).verified).toBe(true);
    });

    it("verifiers cannot link presentations from same credential", async () => {
      const subject: WalletIdentitySubject = {
        walletCommitment: "0xsame_user",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        issuerDid,
        "did:key:holder"
      );

      // Same disclosure to 3 different verifiers
      const verifiers = ["verifier-A", "verifier-B", "verifier-C"];
      const presentations = await Promise.all(
        verifiers.map((nonce) =>
          createPresentation(credential, ["tier"], nonce)
        )
      );

      // All verify
      for (const p of presentations) {
        expect((await verifyPresentation(p)).verified).toBe(true);
        expect(getRevealedClaim(p, "tier")).toBe(2);
      }

      // All proofs are different (unlinkable)
      const proofHexes = presentations.map((p) =>
        Buffer.from(p.proof.proof).toString("hex")
      );
      expect(new Set(proofHexes).size).toBe(3);
    });
  });

  describe("credential revocation simulation", () => {
    it("issuer can refuse to verify revoked credentials", async () => {
      // In production, issuer would maintain a revocation registry
      // This test simulates the verification flow with a "revoked" check

      const revokedCredentialIds = new Set<string>();

      const subject: WalletIdentitySubject = {
        walletCommitment: "0xrevoked_user",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        issuerDid,
        "did:key:revoked-holder"
      );

      // Generate a credential ID from signature hash
      const credentialId = crypto
        .createHash("sha256")
        .update(Buffer.from(credential.signature.signature))
        .digest("hex");

      // Initially not revoked
      expect(revokedCredentialIds.has(credentialId)).toBe(false);
      expect(await verifyCredential(credential)).toBe(true);

      // Revoke the credential
      revokedCredentialIds.add(credentialId);

      // Cryptographic verification still passes (signature is valid)
      expect(await verifyCredential(credential)).toBe(true);

      // But application layer should check revocation
      const isRevoked = revokedCredentialIds.has(credentialId);
      expect(isRevoked).toBe(true);
    });
  });

  describe("message ordering consistency", () => {
    it("messages are correctly ordered per WALLET_CREDENTIAL_CLAIM_ORDER", () => {
      const subject: WalletIdentitySubject = {
        walletCommitment: "0xcommitment",
        network: "ethereum",
        chainId: 1,
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 2,
      };

      const messages = subjectToMessages(subject);

      expect(messages).toHaveLength(5);
      expect(messages[0].id).toBe("walletCommitment");
      expect(messages[1].id).toBe("network");
      expect(messages[2].id).toBe("chainId");
      expect(messages[3].id).toBe("verifiedAt");
      expect(messages[4].id).toBe("tier");
    });

    it("undefined chainId is encoded as empty string", () => {
      const subject: WalletIdentitySubject = {
        walletCommitment: "0xcommitment",
        network: "bitcoin",
        verifiedAt: "2024-01-01T00:00:00Z",
        tier: 1,
      };

      const messages = subjectToMessages(subject);
      const decoder = new TextDecoder();

      expect(decoder.decode(messages[2].value)).toBe("");
    });
  });

  describe("error handling", () => {
    it("verifies credential with mismatched issuer public key fails", async () => {
      const subject: WalletIdentitySubject = {
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        verifiedAt: new Date().toISOString(),
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        issuerDid,
        "did:key:holder"
      );

      // Replace with different public key
      const attackerKeyPair = await generateBbsKeyPair();
      credential.issuerPublicKey = attackerKeyPair.publicKey;

      expect(await verifyCredential(credential)).toBe(false);
    });

    it("presentation with wrong header fails", async () => {
      const subject: WalletIdentitySubject = {
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        verifiedAt: new Date().toISOString(),
        tier: 2,
      };

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        issuerDid,
        "did:key:holder"
      );

      const presentation = await createPresentation(
        credential,
        ["tier"],
        "original-nonce"
      );

      // Tamper with original header
      const encoder = new TextEncoder();
      presentation.header = encoder.encode("tampered-header");

      const result = await verifyPresentation(presentation);
      expect(result.verified).toBe(false);
    });
  });
});
