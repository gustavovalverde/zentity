import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendEmail = vi.fn();
const mockDbGet = vi.fn();

vi.mock("@/lib/email/transport", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
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

const EUR_PURCHASE = {
  type: "purchase",
  merchant: { name: "Corner Books" },
  item: "A paperback",
  amount: { value: "12.00", currency: "EUR" },
};

const X402_PURCHASE = {
  type: "x402_purchase",
  resource_url:
    "https://merchant.example/api/x402/access?resourceId=verified-identity",
  resource_description: "Financial analytics",
  payment_requirements: {
    scheme: "exact",
    network: "eip155:84532",
    amount: "1",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x000000000000000000000000000000000000dEaD",
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  },
  min_identity_strength: "documentary_full",
};

const DEFAULT_PARAMS = {
  userId: "user-1",
  requestId: "req-1",
  scope: "openid",
  approvalUrl: "https://zentity.xyz/approve/req-1",
};

describe("ciba-mailer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    mockSendEmail.mockResolvedValue("sent");
  });

  it("sends email when user has a verified email", async () => {
    mockDbGet.mockReturnValue({
      email: "alice@example.com",
      emailVerified: true,
    });

    const { sendCibaNotification } = await import("../ciba");
    await sendCibaNotification(DEFAULT_PARAMS);

    expect(mockSendEmail).toHaveBeenCalledOnce();
    const payload = mockSendEmail.mock.calls[0]?.[0];
    expect(payload.to).toEqual(["alice@example.com"]);
  });

  it("links to the approval page marked as opened from the email", async () => {
    mockDbGet.mockReturnValue({
      email: "alice@example.com",
      emailVerified: true,
    });

    const { sendCibaNotification } = await import("../ciba");
    await sendCibaNotification(DEFAULT_PARAMS);

    const payload = mockSendEmail.mock.calls[0]?.[0];
    expect(payload.text).toContain(
      "https://zentity.xyz/approve/req-1?via=email"
    );
    expect(payload.html).toContain(
      'href="https://zentity.xyz/approve/req-1?via=email"'
    );
  });

  it("does NOT send email when user email is unverified", async () => {
    mockDbGet.mockReturnValue({
      email: "unverified@example.com",
      emailVerified: false,
    });

    const { sendCibaNotification } = await import("../ciba");
    await sendCibaNotification(DEFAULT_PARAMS);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does NOT send email when user has no email", async () => {
    mockDbGet.mockReturnValue({ email: null, emailVerified: false });

    const { sendCibaNotification } = await import("../ciba");
    await sendCibaNotification(DEFAULT_PARAMS);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does NOT send email when user is not found", async () => {
    mockDbGet.mockReturnValue(undefined);

    const { sendCibaNotification } = await import("../ciba");
    await sendCibaNotification(DEFAULT_PARAMS);

    expect(mockSendEmail).not.toHaveBeenCalled();
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

      const payload = mockSendEmail.mock.calls[0]?.[0];
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

      const payload = mockSendEmail.mock.calls[0]?.[0];
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

      const payload = mockSendEmail.mock.calls[0]?.[0];
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

      const payload = mockSendEmail.mock.calls[0]?.[0];
      expect(payload.html).not.toContain("javascript:alert");
      expect(payload.html).toContain('href="#"');
    });
  });

  describe("request summary", () => {
    beforeEach(() => {
      mockDbGet.mockReturnValue({
        email: "alice@example.com",
        emailVerified: true,
      });
    });

    it("keeps the binding message out of the subject", async () => {
      const { sendCibaNotification } = await import("../ciba");
      await sendCibaNotification({
        ...DEFAULT_PARAMS,
        clientName: "Aether AI",
        bindingMessage: "Confirm code: 4F2A",
      });

      const payload = mockSendEmail.mock.calls[0]?.[0];
      expect(payload.subject).toBe("Aether AI is requesting your approval");
      expect(payload.text).toContain('Message: "Confirm code: 4F2A"');
    });

    it("formats payment amounts in the asset's display unit", async () => {
      const { sendCibaNotification } = await import("../ciba");
      await sendCibaNotification({
        ...DEFAULT_PARAMS,
        authorizationDetails: [
          {
            type: "payment_authorization",
            chain: { namespace: "zcash", reference: "test" },
            recipient: "zcash:test:utest1qq0",
            amount: { currency: "ZEC", value: "1", unit: "base" },
            payment_id: "01KT9A0V431VGD5YH7R7G635HC",
            intent_hash:
              "v1:sha256:tH5IGJbnV6NxSl9nmwbFc8EWDF6rfYcXgOfHFmmIjUQ",
            expires_at: { kind: "block_height", value: 4_047_100 },
          },
        ],
      });

      const payload = mockSendEmail.mock.calls[0]?.[0];
      expect(payload.text).toContain(
        "Payment: 0.00000001 ZEC to zcash:test:utest1qq0"
      );
      expect(payload.html).toContain("0.00000001 ZEC");
      expect(payload.html).not.toContain("base unit");
    });
  });

  // R4 and R18: the email states the merchant's terms, labeled, without "$".
  it.each([
    [
      "an x402 purchase",
      X402_PURCHASE,
      [
        "Prove to merchant.example that your identity is verified (Document, full)",
        "0.000001 USDC on Base Sepolia",
        "Zentity does not sign or limit this payment.",
        "Described by the merchant",
      ],
    ],
    [
      "a direct purchase",
      EUR_PURCHASE,
      ["Stated by the agent", "A paperback from Corner Books, €12.00"],
    ],
  ])("describes %s in server text", async (_case, detail, expected) => {
    mockDbGet.mockReturnValue({
      email: "alice@example.com",
      emailVerified: true,
    });

    const { sendCibaNotification } = await import("../ciba");
    await sendCibaNotification({
      ...DEFAULT_PARAMS,
      authorizationDetails: [detail],
    });

    const payload = mockSendEmail.mock.calls[0]?.[0] as {
      html: string;
      text: string;
    };
    for (const fragment of expected) {
      expect(payload.text).toContain(fragment);
    }
    expect(payload.text).not.toContain("$");
    expect(payload.html).not.toContain("$");
  });
});
