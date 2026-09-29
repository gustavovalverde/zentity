import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendResendMessage = vi.fn().mockResolvedValue(true);
const mockSendMailpitMessage = vi.fn().mockResolvedValue(true);
const mockIsResendConfigured = vi.fn();
const mockIsMailpitConfigured = vi.fn();
const mockDbGet = vi.fn();

vi.mock("@/lib/email/transport", () => ({
  isResendConfigured: () => mockIsResendConfigured(),
  sendResendMessage: (...args: unknown[]) => mockSendResendMessage(...args),
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

vi.mock("@/lib/db/schema/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/schema/auth")>()),
  users: { email: "email", emailVerified: "emailVerified", id: "id" },
}));

// Note: do NOT mock drizzle-orm here — it poisons the vmThread module cache
// for subsequent test files. The db is fully mocked via @/lib/db/connection,
// so the real eq() from drizzle-orm works fine with the mock chain.

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

    const { sendCibaNotification } = await import("../ciba");
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

    const { sendCibaNotification } = await import("../ciba");
    await sendCibaNotification(DEFAULT_PARAMS);

    expect(mockSendMailpitMessage).not.toHaveBeenCalled();
    expect(mockSendResendMessage).not.toHaveBeenCalled();
  });

  it("does NOT send email when user has no email", async () => {
    mockDbGet.mockReturnValue({ email: null, emailVerified: false });

    const { sendCibaNotification } = await import("../ciba");
    await sendCibaNotification(DEFAULT_PARAMS);

    expect(mockSendMailpitMessage).not.toHaveBeenCalled();
    expect(mockSendResendMessage).not.toHaveBeenCalled();
  });

  it("does NOT send email when user is not found", async () => {
    mockDbGet.mockReturnValue(undefined);

    const { sendCibaNotification } = await import("../ciba");
    await sendCibaNotification(DEFAULT_PARAMS);

    expect(mockSendMailpitMessage).not.toHaveBeenCalled();
    expect(mockSendResendMessage).not.toHaveBeenCalled();
  });

  describe("HTML escaping", () => {
    beforeEach(() => {
      mockDbGet.mockReturnValue({
        email: "alice@example.com",
        emailVerified: true,
      });
    });

    it("escapes an HTML-injecting client name", async () => {
      const { sendCibaNotification } = await import("../ciba");
      await sendCibaNotification({
        ...DEFAULT_PARAMS,
        clientName: '<a href="https://evil.example">An application</a>',
      });

      const payload = mockSendMailpitMessage.mock.calls[0]?.[0];
      expect(payload.html).not.toContain('<a href="https://evil.example">');
      expect(payload.html).toContain(
        "&lt;a href=&quot;https://evil.example&quot;&gt;"
      );
    });

    it("escapes an attribute-breakout binding message", async () => {
      const { sendCibaNotification } = await import("../ciba");
      await sendCibaNotification({
        ...DEFAULT_PARAMS,
        bindingMessage: '"><script>alert(1)</script>',
      });

      const payload = mockSendMailpitMessage.mock.calls[0]?.[0];
      expect(payload.html).not.toContain('"><script>');
      expect(payload.html).toContain(
        "&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"
      );
    });

    it("escapes HTML injected via authorization_details fields", async () => {
      const { sendCibaNotification } = await import("../ciba");
      await sendCibaNotification({
        ...DEFAULT_PARAMS,
        authorizationDetails: [
          {
            type: "purchase",
            item: "<img src=x onerror=alert(1)>",
            merchant: '<a href="https://evil.example">merchant</a>',
            amount: { value: "10.00", currency: "USD" },
          },
        ],
      });

      const payload = mockSendMailpitMessage.mock.calls[0]?.[0];
      expect(payload.html).not.toContain("<img src=x onerror=alert(1)>");
      expect(payload.html).not.toContain(
        '<a href="https://evil.example">merchant</a>'
      );
      expect(payload.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    it("falls back to a safe href for a non-http(s) approval URL", async () => {
      const { sendCibaNotification } = await import("../ciba");
      await sendCibaNotification({
        ...DEFAULT_PARAMS,
        approvalUrl: "javascript:alert(document.cookie)",
      });

      const payload = mockSendMailpitMessage.mock.calls[0]?.[0];
      expect(payload.html).not.toContain("javascript:alert");
      expect(payload.html).toContain('href="#"');
    });
  });
});
