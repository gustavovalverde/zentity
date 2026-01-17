/**
 * Shared mock implementations for external services.
 *
 * These mocks provide consistent behavior across unit and integration tests,
 * avoiding the need to set up real external services.
 */
import { type Mock, vi } from "vitest";

/**
 * Mock FHE service responses.
 */
export interface MockFheService {
  encrypt: Mock;
  decrypt: Mock;
  registerKeys: Mock;
  health: Mock;
}

/**
 * Creates a mock FHE service with default implementations.
 */
export function mockFheService(): MockFheService {
  return {
    encrypt: vi.fn().mockResolvedValue({
      ciphertext: "0xmocked_ciphertext",
      keyId: "mock-key-id",
      encryptionTimeMs: 50,
    }),
    decrypt: vi.fn().mockResolvedValue({
      plaintext: 123,
      decryptionTimeMs: 30,
    }),
    registerKeys: vi.fn().mockResolvedValue({
      success: true,
      keyId: "mock-key-id",
    }),
    health: vi.fn().mockResolvedValue({
      status: "healthy",
      version: "1.0.0",
    }),
  };
}

/**
 * Mock OCR service responses.
 */
export interface MockOcrService {
  processDocument: Mock;
  health: Mock;
}

/**
 * Creates a mock OCR service with default implementations.
 */
export function mockOcrService(): MockOcrService {
  return {
    processDocument: vi.fn().mockResolvedValue({
      documentType: "passport",
      documentOrigin: "USA",
      confidence: 0.95,
      extractedData: {
        fullName: "Test User",
        firstName: "Test",
        lastName: "User",
        dateOfBirth: "1990-01-15",
        documentNumber: "P123456789",
        expiryDate: "2030-01-15",
        nationality: "USA",
      },
      validationIssues: [],
    }),
    health: vi.fn().mockResolvedValue({
      status: "healthy",
      version: "1.0.0",
    }),
  };
}

/**
 * Mock liveness service responses.
 */
export interface MockLivenessService {
  startSession: Mock;
  verifyChallenge: Mock;
  getSessionStatus: Mock;
}

/**
 * Creates a mock liveness service with default implementations.
 */
export function mockLivenessService(): MockLivenessService {
  return {
    startSession: vi.fn().mockResolvedValue({
      sessionId: `liveness-${crypto.randomUUID()}`,
      challenges: ["smile", "blink", "turn_left"],
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
    verifyChallenge: vi.fn().mockResolvedValue({
      passed: true,
      score: 0.98,
      challenge: "smile",
    }),
    getSessionStatus: vi.fn().mockResolvedValue({
      sessionId: "liveness-session",
      status: "completed",
      passedChallenges: ["smile", "blink", "turn_left"],
      overallScore: 0.97,
    }),
  };
}

/**
 * Mock blockchain service responses.
 */
export interface MockBlockchainService {
  submitAttestation: Mock;
  getAttestationStatus: Mock;
  estimateGas: Mock;
}

/**
 * Creates a mock blockchain service with default implementations.
 */
export function mockBlockchainService(): MockBlockchainService {
  return {
    submitAttestation: vi.fn().mockResolvedValue({
      txHash: "0xmocked_tx_hash",
      blockNumber: null,
      status: "submitted",
    }),
    getAttestationStatus: vi.fn().mockResolvedValue({
      txHash: "0xmocked_tx_hash",
      blockNumber: 12_345,
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
    }),
    estimateGas: vi.fn().mockResolvedValue({
      gasEstimate: "100000",
      maxFeePerGas: "1000000000",
      maxPriorityFeePerGas: "100000000",
    }),
  };
}

/**
 * Mock ZK proving service responses.
 */
export interface MockZkService {
  generateProof: Mock;
  verifyProof: Mock;
}

/**
 * Creates a mock ZK service with default implementations.
 */
export function mockZkService(): MockZkService {
  return {
    generateProof: vi.fn().mockResolvedValue({
      proof: new Uint8Array([0x01, 0x02, 0x03]),
      publicInputs: ["0x123", "0x456"],
      provingTimeMs: 500,
    }),
    verifyProof: vi.fn().mockResolvedValue({
      valid: true,
      verificationTimeMs: 50,
    }),
  };
}

/**
 * Creates all service mocks at once.
 */
export function createAllServiceMocks() {
  return {
    fhe: mockFheService(),
    ocr: mockOcrService(),
    liveness: mockLivenessService(),
    blockchain: mockBlockchainService(),
    zk: mockZkService(),
  };
}
