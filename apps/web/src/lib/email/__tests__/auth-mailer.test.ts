import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendResendMessage = vi.fn().mockResolvedValue(true);
const mockSendMailpitMessage = vi.fn().mockResolvedValue(true);
const mockIsResendConfigured = vi.fn();
const mockIsMailpitConfigured = vi.fn();

vi.mock("@/lib/email/resend", () => ({
  isResendConfigured: () => mockIsResendConfigured(),
  sendResendMessage: (...args: unknown[]) => mockSendResendMessage(...args),
}));

vi.mock("@/lib/email/mailpit", () => ({
  isMailpitConfigured: () => mockIsMailpitConfigured(),
  sendMailpitMessage: (...args: unknown[]) => mockSendMailpitMessage(...args),
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("auth-mailer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    mockIsResendConfigured.mockReturnValue(false);
    mockIsMailpitConfigured.mockReturnValue(false);
  });

  describe("sendResetPasswordEmail", () => {
    it("sends via Mailpit in dev when configured", async () => {
      mockIsMailpitConfigured.mockReturnValue(true);
      const { sendResetPasswordEmail } = await import("../auth-mailer");

      await sendResetPasswordEmail({
        user: { email: "test@example.com", name: "Alice" },
        url: "https://zentity.xyz/reset?token=abc",
      });

      expect(mockSendMailpitMessage).toHaveBeenCalledOnce();
      const payload = mockSendMailpitMessage.mock.calls[0][0];
      expect(payload.to).toEqual(["test@example.com"]);
      expect(payload.subject).toContain("Reset");
      expect(payload.text).toContain("https://zentity.xyz/reset?token=abc");
      expect(payload.html).toContain("https://zentity.xyz/reset?token=abc");
    });

    it("sends via Resend in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      mockIsResendConfigured.mockReturnValue(true);
      const { sendResetPasswordEmail } = await import("../auth-mailer");

      await sendResetPasswordEmail({
        user: { email: "prod@example.com" },
        url: "https://app.zentity.xyz/reset?token=xyz",
      });

      expect(mockSendResendMessage).toHaveBeenCalledOnce();
      expect(mockSendMailpitMessage).not.toHaveBeenCalled();
      const payload = mockSendResendMessage.mock.calls[0][0];
      expect(payload.to).toEqual(["prod@example.com"]);
      expect(payload.text).toContain("https://app.zentity.xyz/reset?token=xyz");
    });

    it("falls back to console when no transport configured", async () => {
      const { logger } = await import("@/lib/logging/logger");
      const { sendResetPasswordEmail } = await import("../auth-mailer");

      await sendResetPasswordEmail({
        user: { email: "no-transport@example.com" },
        url: "https://zentity.xyz/reset?token=fallback",
      });

      expect(mockSendResendMessage).not.toHaveBeenCalled();
      expect(mockSendMailpitMessage).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("sendMagicLinkEmail", () => {
    it("sends via Mailpit in dev when configured", async () => {
      mockIsMailpitConfigured.mockReturnValue(true);
      const { sendMagicLinkEmail } = await import("../auth-mailer");

      await sendMagicLinkEmail({
        email: "magic@example.com",
        url: "https://zentity.xyz/magic?token=abc",
      });

      expect(mockSendMailpitMessage).toHaveBeenCalledOnce();
      const payload = mockSendMailpitMessage.mock.calls[0][0];
      expect(payload.to).toEqual(["magic@example.com"]);
      expect(payload.subject).toContain("Sign in");
      expect(payload.text).toContain("https://zentity.xyz/magic?token=abc");
      expect(payload.html).toContain("https://zentity.xyz/magic?token=abc");
    });

    it("sends via Resend when configured and not in Mailpit mode", async () => {
      mockIsResendConfigured.mockReturnValue(true);
      const { sendMagicLinkEmail } = await import("../auth-mailer");

      await sendMagicLinkEmail({
        email: "resend@example.com",
        url: "https://zentity.xyz/magic?token=xyz",
      });

      expect(mockSendResendMessage).toHaveBeenCalledOnce();
      const payload = mockSendResendMessage.mock.calls[0][0];
      expect(payload.to).toEqual(["resend@example.com"]);
      expect(payload.text).toContain("https://zentity.xyz/magic?token=xyz");
    });

    it("falls back to console when no transport configured", async () => {
      const { logger } = await import("@/lib/logging/logger");
      const { sendMagicLinkEmail } = await import("../auth-mailer");

      await sendMagicLinkEmail({
        email: "fallback@example.com",
        url: "https://zentity.xyz/magic?token=fallback",
      });

      expect(mockSendResendMessage).not.toHaveBeenCalled();
      expect(mockSendMailpitMessage).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });
  });
});
