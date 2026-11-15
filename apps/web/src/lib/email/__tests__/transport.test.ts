import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logging/error-logger", () => ({ logWarn: vi.fn() }));

const mockResendSend = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => mockResendSend(...args) };
  },
}));

const baseEnv = { MAIL_FROM_EMAIL: "no-reply@zentity.xyz" };
const message = { to: [" a@example.com ", ""], subject: "s", text: "t" };

async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.doMock("@/env", () => ({ env: { ...baseEnv, ...env } }));
  return await import("../transport");
}

describe("sendEmail", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true });
    mockResendSend.mockResolvedValue({ error: null });
  });

  it("prefers Mailpit outside production and trims recipients", async () => {
    const { sendEmail } = await load({
      MAILPIT_BASE_URL: "http://mailpit:8025",
      RESEND_API_KEY: "key",
    });

    await expect(sendEmail(message)).resolves.toBe("sent");
    expect(mockResendSend).not.toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body);
    expect(body.To).toEqual([{ Email: "a@example.com" }]);
  });

  it("uses Resend in production even when Mailpit is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { sendEmail } = await load({
      MAILPIT_BASE_URL: "http://mailpit:8025",
      RESEND_API_KEY: "key",
    });

    await expect(sendEmail(message)).resolves.toBe("sent");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockResendSend.mock.calls[0]?.[0].to).toEqual(["a@example.com"]);
  });

  it("reports unconfigured when no transport exists", async () => {
    const { sendEmail } = await load({});
    await expect(sendEmail(message)).resolves.toBe("unconfigured");
  });

  it("reports failed when delivery fails or no recipient remains", async () => {
    const { sendEmail } = await load({ MAILPIT_BASE_URL: "http://m:8025" });
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(sendEmail(message)).resolves.toBe("failed");
    await expect(sendEmail({ ...message, to: [" "] })).resolves.toBe("failed");
  });
});
