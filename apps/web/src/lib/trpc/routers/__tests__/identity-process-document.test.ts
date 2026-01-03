/**
 * Tests for identity.processDocument (OCR-only onboarding step).
 */

import type { DocumentResult } from "@/lib/document/document-ocr";

import { describe, expect, it, vi } from "vitest";

const mockGetSessionFromCookie = vi.fn();
const mockValidateStepAccess = vi.fn();
const mockProcessDocument = vi.fn();

vi.mock("@/lib/db/onboarding-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/onboarding-session")>();
  return {
    ...actual,
    getSessionFromCookie: (...args: unknown[]) =>
      mockGetSessionFromCookie(...args),
    validateStepAccess: (...args: unknown[]) => mockValidateStepAccess(...args),
  };
});

vi.mock("@/lib/document/document-ocr", () => ({
  processDocument: (...args: unknown[]) => mockProcessDocument(...args),
}));

async function createCaller(ip: string) {
  const { identityRouter } = await import("@/lib/trpc/routers/identity");
  return identityRouter.createCaller({
    req: new Request("http://localhost/api/trpc", {
      headers: { "x-forwarded-for": ip },
    }),
    resHeaders: new Headers(),
    session: null,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none",
    onboardingSessionId: null,
  });
}

describe("identity.processDocument", () => {
  it("rejects when onboarding session is invalid", async () => {
    mockGetSessionFromCookie.mockResolvedValue(null);
    mockValidateStepAccess.mockReturnValue({
      valid: false,
      error: "Session required",
    });

    const caller = await createCaller("10.0.0.1");
    await expect(
      caller.processDocument({ image: "base64" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns OCR result when processing succeeds", async () => {
    mockGetSessionFromCookie.mockResolvedValue({ id: "session" });
    mockValidateStepAccess.mockReturnValue({ valid: true });

    const result: DocumentResult = {
      documentType: "passport",
      documentOrigin: "USA",
      confidence: 0.9,
      extractedData: {
        fullName: "Test User",
        documentNumber: "P123",
      },
      validationIssues: [],
    };
    mockProcessDocument.mockResolvedValue(result);

    const caller = await createCaller("10.0.0.2");
    const response = await caller.processDocument({ image: "base64" });

    expect(response.documentType).toBe("passport");
    expect(response.documentOrigin).toBe("USA");
    expect(response.extractedData?.documentNumber).toBe("P123");
  });

  it("maps OCR service outages to SERVICE_UNAVAILABLE", async () => {
    mockGetSessionFromCookie.mockResolvedValue({ id: "session" });
    mockValidateStepAccess.mockReturnValue({ valid: true });
    mockProcessDocument.mockRejectedValue(new Error("ECONNREFUSED"));

    const caller = await createCaller("10.0.0.3");
    await expect(
      caller.processDocument({ image: "base64" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("maps unknown OCR errors to INTERNAL_SERVER_ERROR", async () => {
    mockGetSessionFromCookie.mockResolvedValue({ id: "session" });
    mockValidateStepAccess.mockReturnValue({ valid: true });
    mockProcessDocument.mockRejectedValue(new Error("bad input"));

    const caller = await createCaller("10.0.0.4");
    await expect(
      caller.processDocument({ image: "base64" })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("rate limits repeated requests from the same IP", async () => {
    mockGetSessionFromCookie.mockResolvedValue({ id: "session" });
    mockValidateStepAccess.mockReturnValue({ valid: true });
    mockProcessDocument.mockResolvedValue({
      documentType: "unknown",
      confidence: 0,
      validationIssues: [],
    } satisfies DocumentResult);

    const caller = await createCaller("10.0.0.5");
    for (let i = 0; i < 10; i += 1) {
      await caller.processDocument({ image: `base64-${i}` });
    }

    await expect(
      caller.processDocument({ image: "base64-11" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
