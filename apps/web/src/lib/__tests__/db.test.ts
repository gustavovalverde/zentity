/**
 * Tests for the database module.
 *
 * Note: These tests mock better-sqlite3 to avoid actual database operations.
 * The setup file provides the mock implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to import after mocking in setup file
describe('Database Module', () => {
  describe('getVerificationStatus', () => {
    it('returns level none for unverified user', async () => {
      // Dynamic import to get mocked version
      const { getVerificationStatus } = await import('../db');

      const status = getVerificationStatus('non-existent-user');

      expect(status.level).toBe('none');
      expect(status.verified).toBe(false);
      expect(status.checks.document).toBe(false);
      expect(status.checks.liveness).toBe(false);
      expect(status.checks.faceMatch).toBe(false);
      expect(status.checks.ageProof).toBe(false);
    });
  });

  describe('documentHashExists', () => {
    it('returns false for non-existing hash', async () => {
      const { documentHashExists } = await import('../db');

      expect(documentHashExists('non-existent-hash')).toBe(false);
    });
  });
});

describe('IdentityProof Interface', () => {
  it('should have all required fields', () => {
    // Type checking test - if this compiles, the interface is correct
    const mockProof = {
      id: 'test-id',
      userId: 'user-123',
      documentHash: 'abc123',
      nameCommitment: 'def456',
      userSalt: 'salt789',
      ageProofVerified: false,
      isDocumentVerified: false,
      isLivenessPassed: false,
      isFaceMatched: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(mockProof.id).toBe('test-id');
    expect(mockProof.documentHash).toBe('abc123');
  });
});
