import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendResendMessage = vi.fn().mockResolvedValue(true);
const mockSendMailpitMessage = vi.fn().mockResolvedValue(true);
const mockIsResendConfigured = vi.fn();
const mockIsMailpitConfigured = vi.fn();
const mockDbGet = vi.fn();

vi.mock("@/lib/email/resend", () => ({
  isResendConfigured: () => mockIsResendConfigured(),
  sendResendMessage: (...args: unknown[]) => mockSendResendMessage(...args),
}));

vi.mock("@/lib/email/mailpit", () => ({
  isMailpitConfigured: () => mockIsMailpitConfigured(),
  sendMailpitMessage: (...args: unknown[]) => mockSendMailpitMessage(...args),
}));

vi.mock("@/lib/db/connection", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            get: () => mockDbGet(),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema/auth", () => ({
  users: { email: "email", emailVerified: "emailVerified", id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => args,
}));

const DEFAULT_PARAMS = {
  userId: "user-1",
  authReqId: "req-1",
  scope: "openid",
  approvalUrl: "https://zentity.xyz/approve/req-1",
};

describe("ciba-mailer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    mockIsResendConfigured.mockReturnValue(false);
    mockIsMailpitConfigured.mockReturnValue(true);
  });

  it("sends email when user has a verified email", async () => {
    mockDbGet.mockReturnValue({
      email: "alice@example.com",
      emailVerified: true,
    });

    const { sendCibaNotification } = await import("../ciba-mailer");
    await sendCibaNotification(DEFAULT_PARAMS);

    expect(mockSendMailpitMessage).toHaveBeenCalledOnce();
    const payload = mockSendMailpitMessage.mock.calls[0]?.[0];
    expect(payload.to).toEqual(["alice@example.com"]);
  });

  it("does NOT send email when user email is unverified", async () => {
    mockDbGet.mockReturnValue({
      email: "unverified@example.com",
      emailVerified: false,
    });

    const { sendCibaNotification } = await import("../ciba-mailer");
    await sendCibaNotification(DEFAULT_PARAMS);

    expect(mockSendMailpitMessage).not.toHaveBeenCalled();
    expect(mockSendResendMessage).not.toHaveBeenCalled();
  });

  it("does NOT send email when user has no email", async () => {
    mockDbGet.mockReturnValue({ email: null, emailVerified: false });

    const { sendCibaNotification } = await import("../ciba-mailer");
    await sendCibaNotification(DEFAULT_PARAMS);

    expect(mockSendMailpitMessage).not.toHaveBeenCalled();
    expect(mockSendResendMessage).not.toHaveBeenCalled();
  });

  it("does NOT send email when user is not found", async () => {
    mockDbGet.mockReturnValue(undefined);

    const { sendCibaNotification } = await import("../ciba-mailer");
    await sendCibaNotification(DEFAULT_PARAMS);

    expect(mockSendMailpitMessage).not.toHaveBeenCalled();
    expect(mockSendResendMessage).not.toHaveBeenCalled();
  });
});
