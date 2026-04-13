import { describe, expect, it } from "vitest";

import { resolveAudience } from "@/lib/http/url-safety";

describe("resolveAudience", () => {
  it("prefers Origin header when present", () => {
    const req = new Request("http://internal:3000/api/trpc", {
      headers: {
        origin: "https://app.example.com",
      },
    });

    expect(resolveAudience(req)).toBe("https://app.example.com");
  });

  it("uses forwarded host/proto when Origin header is missing", () => {
    const req = new Request("http://127.0.0.1:3000/api/trpc", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "verify.example.com",
      },
    });

    expect(resolveAudience(req)).toBe("https://verify.example.com");
  });

  it("falls back to request URL origin", () => {
    const req = new Request("http://localhost:3000/api/trpc");
    expect(resolveAudience(req)).toBe("http://localhost:3000");
  });
});
