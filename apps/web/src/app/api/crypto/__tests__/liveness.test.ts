/**
 * Tests for Liveness FHE API endpoints
 *
 * Tests the encrypt-liveness and verify-liveness-threshold endpoints
 * that provide privacy-preserving liveness score operations.
 */

import { NextRequest } from "next/server";
/* eslint @typescript-eslint/no-explicit-any: off */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth module
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn(() => new Headers()),
}));

// Store original fetch
const originalFetch = global.fetch;

describe("Liveness FHE API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("POST /api/crypto/encrypt-liveness", () => {
    it("should return 401 when not authenticated", async () => {
      // Mock unauthenticated session
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      const { POST } = await import("../encrypt-liveness/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/encrypt-liveness",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score: 0.85 }),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(401);
    });

    it("should return 400 when score is missing", async () => {
      // Mock authenticated session
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      } as any);

      const { POST } = await import("../encrypt-liveness/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/encrypt-liveness",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain("score");
    });

    it("should return 400 when score is out of range (> 1.0)", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      } as any);

      const { POST } = await import("../encrypt-liveness/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/encrypt-liveness",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score: 1.5 }),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it("should return 400 when score is negative", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      } as any);

      const { POST } = await import("../encrypt-liveness/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/encrypt-liveness",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score: -0.1 }),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it("should encrypt valid liveness score", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      } as any);

      // Mock successful FHE service response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ciphertext: "encrypted-ciphertext-base64",
            clientKeyId: "default",
            score: 0.85,
          }),
      });

      const { POST } = await import("../encrypt-liveness/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/encrypt-liveness",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score: 0.85 }),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.ciphertext).toBe("encrypted-ciphertext-base64");
      expect(data.score).toBe(0.85);
    });

    it("should handle FHE service errors", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      } as any);

      // Mock FHE service error
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "FHE service unavailable" }),
      });

      const { POST } = await import("../encrypt-liveness/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/encrypt-liveness",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score: 0.85 }),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(500);
    });

    it("should accept boundary values (0.0 and 1.0)", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      } as any);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ciphertext: "encrypted",
            clientKeyId: "default",
            score: 0.0,
          }),
      });

      const { POST } = await import("../encrypt-liveness/route");

      // Test score = 0.0
      const request0 = new NextRequest(
        "http://localhost:3000/api/crypto/encrypt-liveness",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score: 0.0 }),
        },
      );

      const response0 = await POST(request0);
      expect(response0.status).toBe(200);

      // Test score = 1.0
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ciphertext: "encrypted",
            clientKeyId: "default",
            score: 1.0,
          }),
      } as any);

      const request1 = new NextRequest(
        "http://localhost:3000/api/crypto/encrypt-liveness",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score: 1.0 }),
        },
      );

      const response1 = await POST(request1);
      expect(response1.status).toBe(200);
    });
  });

  describe("POST /api/crypto/verify-liveness-threshold", () => {
    it("should return 401 when not authenticated", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      const { POST } = await import("../verify-liveness-threshold/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/verify-liveness-threshold",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ciphertext: "test", threshold: 0.3 }),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(401);
    });

    it("should return 400 when ciphertext is missing", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      } as any);

      const { POST } = await import("../verify-liveness-threshold/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/verify-liveness-threshold",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threshold: 0.3 }),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain("ciphertext");
    });

    it("should return 400 when threshold is out of range", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      } as any);

      const { POST } = await import("../verify-liveness-threshold/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/verify-liveness-threshold",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ciphertext: "test", threshold: 1.5 }),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it("should use default threshold (0.3) when not provided", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      } as any);

      let capturedBody: any;
      global.fetch = vi.fn().mockImplementation((_url, options) => {
        capturedBody = JSON.parse(options?.body as string);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              passesThreshold: true,
              threshold: 0.3,
              computationTimeMs: 100,
            }),
        });
      });

      const { POST } = await import("../verify-liveness-threshold/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/verify-liveness-threshold",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ciphertext: "encrypted-data" }),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(capturedBody.threshold).toBe(0.3);
    });

    it("should verify threshold successfully", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      } as any);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            passesThreshold: true,
            threshold: 0.5,
            computationTimeMs: 150,
          }),
      });

      const { POST } = await import("../verify-liveness-threshold/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/verify-liveness-threshold",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ciphertext: "encrypted-data",
            threshold: 0.5,
          }),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.passesThreshold).toBe(true);
      expect(data.threshold).toBe(0.5);
      expect(data.computationTimeMs).toBe(150);
    });

    it("should return false when threshold not met", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "test-user" },
        session: { id: "test-session" },
      } as any);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            passesThreshold: false,
            threshold: 0.9,
            computationTimeMs: 150,
          }),
      });

      const { POST } = await import("../verify-liveness-threshold/route");

      const request = new NextRequest(
        "http://localhost:3000/api/crypto/verify-liveness-threshold",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ciphertext: "encrypted-data",
            threshold: 0.9,
          }),
        },
      );

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.passesThreshold).toBe(false);
    });
  });
});
