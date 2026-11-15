import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendEmail = vi.fn();

vi.mock("@/lib/email/transport", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("auth mailer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue("sent");
  });

  it("sends the reset password email", async () => {
    const { sendResetPasswordEmail } = await import("../auth");

    await sendResetPasswordEmail({
      user: { email: "test@example.com", name: "Alice" },
      url: "https://zentity.xyz/reset?token=abc",
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    const payload = mockSendEmail.mock.calls[0]?.[0];
    expect(payload.to).toEqual(["test@example.com"]);
    expect(payload.subject).toContain("Reset");
    expect(payload.text).toContain("https://zentity.xyz/reset?token=abc");
    expect(payload.html).toContain("https://zentity.xyz/reset?token=abc");
  });

  it("sends the magic link email", async () => {
    const { sendMagicLinkEmail } = await import("../auth");

    await sendMagicLinkEmail({
      email: "magic@example.com",
      url: "https://zentity.xyz/magic?token=abc",
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    const payload = mockSendEmail.mock.calls[0]?.[0];
    expect(payload.to).toEqual(["magic@example.com"]);
    expect(payload.subject).toContain("Sign in");
    expect(payload.html).toContain("https://zentity.xyz/magic?token=abc");
  });

  it("logs the action URL when no transport is configured", async () => {
    mockSendEmail.mockResolvedValue("unconfigured");
    const { logger } = await import("@/lib/logging/logger");
    const { sendMagicLinkEmail } = await import("../auth");

    await sendMagicLinkEmail({
      email: "fallback@example.com",
      url: "https://zentity.xyz/magic?token=fallback",
    });

    expect(logger.info).toHaveBeenCalledWith(
      { url: expect.stringContaining("token=fallback") },
      "Action URL"
    );
  });

  it("does not log the action URL when the email was sent", async () => {
    const { logger } = await import("@/lib/logging/logger");
    const { sendMagicLinkEmail } = await import("../auth");

    await sendMagicLinkEmail({
      email: "sent@example.com",
      url: "https://zentity.xyz/magic?token=sent",
    });

    expect(logger.info).not.toHaveBeenCalled();
  });
});
