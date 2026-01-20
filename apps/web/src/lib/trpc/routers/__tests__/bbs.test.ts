/**
 * BBS+ Wallet Credentials Router Tests (RFC-0020)
 *
 * Tests for the BBS+ tRPC router focused on wallet identity binding:
 * - Wallet credential issuance
 * - Presentation creation for identity circuit
 * - Presentation verification
 * - Authorization checks
 */

import type { Session } from "@/lib/auth/auth";

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockGetAssuranceState = vi.fn();

vi.mock("@/lib/assurance/data", () => ({
  getAssuranceState: (...args: unknown[]) => mockGetAssuranceState(...args),
}));

// Set up BBS issuer secret for tests (64 hex chars = 32 bytes)
process.env.BBS_ISSUER_SECRET = "0".repeat(64);

function createTier2State() {
  return {
    tier: 2,
    tierName: "Verified",
    authStrength: "strong" as const,
    loginMethod: "passkey" as const,
    details: {
      isAuthenticated: true,
      hasSecuredKeys: true,
      documentVerified: true,
      livenessVerified: true,
      faceMatchVerified: true,
      zkProofsComplete: true,
      fheComplete: true,
      hasIncompleteProofs: false,
      onChainAttested: false,
    },
  };
}

const authedSession = {
  user: { id: "test-user-123", twoFactorEnabled: true },
  session: { id: "test-session", lastLoginMethod: "passkey" },
} as unknown as Session;

const anotherUserSession = {
  user: { id: "another-user-456", twoFactorEnabled: true },
  session: { id: "another-session", lastLoginMethod: "passkey" },
} as unknown as Session;

async function createCaller(session: Session | null) {
  const { bbsRouter } = await import("@/lib/trpc/routers/crypto/bbs");
  return bbsRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    session,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none",
  });
}

describe("BBS credentials router", () => {
  beforeAll(() => {
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAssuranceState.mockResolvedValue(createTier2State());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("issueWalletCredential", () => {
    it("issues credential to authenticated user", async () => {
      const caller = await createCaller(authedSession);

      const result = await caller.issueWalletCredential({
        walletCommitment: "0x1234567890abcdef",
        network: "ethereum",
        chainId: 1,
        tier: 2,
      });

      expect(result.credential.format).toBe("bbs+vc");
      expect(result.credential.issuer).toBe("did:web:zentity.xyz");
      expect(result.credential.holder).toBe("did:key:user-test-user-123");
      expect(result.credential.subject.walletCommitment).toBe(
        "0x1234567890abcdef"
      );
      expect(result.credential.subject.network).toBe("ethereum");
      expect(result.credential.subject.chainId).toBe(1);
      expect(result.credential.subject.tier).toBe(2);
      expect(result.credential.signature.signature).toBeDefined();
      expect(result.credential.issuerPublicKey).toBeDefined();
    });

    it("issues credential without optional chainId", async () => {
      const caller = await createCaller(authedSession);

      const result = await caller.issueWalletCredential({
        walletCommitment: "0xbitcoin_commitment",
        network: "bitcoin",
        tier: 1,
      });

      expect(result.credential.subject.chainId).toBeUndefined();
      expect(result.credential.subject.network).toBe("bitcoin");
    });

    it("rejects unauthenticated issuance", async () => {
      const caller = await createCaller(null);

      await expect(
        caller.issueWalletCredential({
          walletCommitment: "0xtest",
          network: "ethereum",
          chainId: 1,
          tier: 2,
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("validates wallet commitment format", async () => {
      const caller = await createCaller(authedSession);

      await expect(
        caller.issueWalletCredential({
          walletCommitment: "invalid-commitment",
          network: "ethereum",
          chainId: 1,
          tier: 2,
        })
      ).rejects.toThrow();
    });
  });

  describe("createPresentation", () => {
    it("creates presentation with selective disclosure", async () => {
      const caller = await createCaller(authedSession);

      // First issue a credential
      const { credential } = await caller.issueWalletCredential({
        walletCommitment: "0xsecret_commitment",
        network: "ethereum",
        chainId: 1,
        tier: 3,
      });

      // Create presentation revealing only tier
      const result = await caller.createPresentation({
        credential,
        revealClaims: ["tier"],
        verifierNonce: "verifier-challenge-nonce",
      });

      expect(result.presentation.format).toBe("bbs+vp");
      expect(result.presentation.revealedClaims).toHaveProperty("tier", 3);
      expect(result.presentation.revealedClaims).not.toHaveProperty(
        "walletCommitment"
      );
      expect(result.presentation.proof.proof).toBeDefined();
    });

    it("creates presentation revealing multiple claims", async () => {
      const caller = await createCaller(authedSession);

      const { credential } = await caller.issueWalletCredential({
        walletCommitment: "0xtest",
        network: "polygon",
        chainId: 137,
        tier: 2,
      });

      const result = await caller.createPresentation({
        credential,
        revealClaims: ["network", "chainId", "tier"],
        verifierNonce: "nonce-123",
      });

      expect(result.presentation.revealedClaims.network).toBe("polygon");
      expect(result.presentation.revealedClaims.chainId).toBe(137);
      expect(result.presentation.revealedClaims.tier).toBe(2);
    });

    it("rejects presentation for credential not owned by user", async () => {
      // User A issues credential
      const callerA = await createCaller(authedSession);
      const { credential } = await callerA.issueWalletCredential({
        walletCommitment: "0xuser_a_commitment",
        network: "ethereum",
        chainId: 1,
        tier: 2,
      });

      // User B tries to create presentation for User A's credential
      const callerB = await createCaller(anotherUserSession);
      await expect(
        callerB.createPresentation({
          credential,
          revealClaims: ["tier"],
          verifierNonce: "attacker-nonce",
        })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Credential does not belong to authenticated user",
      });
    });

    it("rejects unauthenticated presentation creation", async () => {
      const authedCaller = await createCaller(authedSession);
      const { credential } = await authedCaller.issueWalletCredential({
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        tier: 2,
      });

      const unauthedCaller = await createCaller(null);
      await expect(
        unauthedCaller.createPresentation({
          credential,
          revealClaims: ["tier"],
          verifierNonce: "nonce",
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("verifyPresentation", () => {
    it("verifies valid presentation", async () => {
      const caller = await createCaller(authedSession);

      const { credential } = await caller.issueWalletCredential({
        walletCommitment: "0xvalid_commitment",
        network: "ethereum",
        chainId: 1,
        tier: 2,
      });

      const { presentation } = await caller.createPresentation({
        credential,
        revealClaims: ["network", "tier"],
        verifierNonce: "verification-nonce",
      });

      // Verification is public - no auth needed
      const unauthedCaller = await createCaller(null);
      const result = await unauthedCaller.verifyPresentation({
        presentation,
      });

      expect(result.verified).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.revealedClaims?.network).toBe("ethereum");
      expect(result.revealedClaims?.tier).toBe(2);
    });

    it("rejects tampered presentation", async () => {
      const caller = await createCaller(authedSession);

      const { credential } = await caller.issueWalletCredential({
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        tier: 2,
      });

      const { presentation } = await caller.createPresentation({
        credential,
        revealClaims: ["tier"],
        verifierNonce: "nonce",
      });

      // Tamper with proof bytes
      const tamperedProof = Buffer.from(presentation.proof.proof, "base64");
      // biome-ignore lint/suspicious/noBitwiseOperators: Intentional bit flip for tampering test
      tamperedProof[0] ^= 0xff;
      presentation.proof.proof = tamperedProof.toString("base64");

      const unauthedCaller = await createCaller(null);
      const result = await unauthedCaller.verifyPresentation({
        presentation,
      });

      expect(result.verified).toBe(false);
      expect(result.revealedClaims).toBeNull();
    });

    it("allows unauthenticated verification", async () => {
      const authedCaller = await createCaller(authedSession);

      const { credential } = await authedCaller.issueWalletCredential({
        walletCommitment: "0xtest",
        network: "ethereum",
        chainId: 1,
        tier: 2,
      });

      const { presentation } = await authedCaller.createPresentation({
        credential,
        revealClaims: ["tier"],
        verifierNonce: "nonce",
      });

      // Public verification - no auth required
      const unauthedCaller = await createCaller(null);
      const result = await unauthedCaller.verifyPresentation({
        presentation,
      });

      expect(result.verified).toBe(true);
    });
  });

  describe("getIssuerPublicKey", () => {
    it("returns issuer public key", async () => {
      const caller = await createCaller(null);
      const result = await caller.getIssuerPublicKey();

      expect(result.did).toBe("did:web:zentity.xyz");
      expect(result.publicKey).toBeDefined();
      expect(typeof result.publicKey).toBe("string");
      // BBS+ public key is 96 bytes, base64 encoded ~ 128 chars
      expect(result.publicKey.length).toBeGreaterThan(100);
    });

    it("returns consistent public key across calls", async () => {
      const caller = await createCaller(null);

      const result1 = await caller.getIssuerPublicKey();
      const result2 = await caller.getIssuerPublicKey();

      expect(result1.publicKey).toBe(result2.publicKey);
    });
  });

  describe("end-to-end flow", () => {
    it("complete credential lifecycle", async () => {
      const caller = await createCaller(authedSession);
      const publicCaller = await createCaller(null);

      // 1. Issue credential
      const { credential } = await caller.issueWalletCredential({
        walletCommitment: "0xe2e_test_commitment",
        network: "polygon",
        chainId: 137,
        tier: 3,
      });

      expect(credential.format).toBe("bbs+vc");

      // 2. Create multiple presentations with different disclosures
      const { presentation: tierOnly } = await caller.createPresentation({
        credential,
        revealClaims: ["tier"],
        verifierNonce: "defi-protocol-nonce",
      });

      const { presentation: networkAndTier } = await caller.createPresentation({
        credential,
        revealClaims: ["network", "tier"],
        verifierNonce: "bridge-protocol-nonce",
      });

      // 3. Verify both presentations publicly
      const tierResult = await publicCaller.verifyPresentation({
        presentation: tierOnly,
      });
      const networkResult = await publicCaller.verifyPresentation({
        presentation: networkAndTier,
      });

      expect(tierResult.verified).toBe(true);
      expect(tierResult.revealedClaims?.tier).toBe(3);
      expect(tierResult.revealedClaims?.network).toBeUndefined();

      expect(networkResult.verified).toBe(true);
      expect(networkResult.revealedClaims?.tier).toBe(3);
      expect(networkResult.revealedClaims?.network).toBe("polygon");

      // 4. Presentations should be unlinkable (different proof bytes)
      expect(tierOnly.proof.proof).not.toBe(networkAndTier.proof.proof);
    });
  });
});
