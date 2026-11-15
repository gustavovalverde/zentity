import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../route";

const SHA1 = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";
const SUFFIX = SHA1.slice(5);

const post = (body: BodyInit) =>
  POST(
    new Request("http://localhost/api/password/pwned", {
      method: "POST",
      body,
    })
  );

describe("password/pwned route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["unreadable JSON", "not json"],
    ["a missing hash", JSON.stringify({})],
    ["a non-string hash", JSON.stringify({ sha1: 1 })],
    ["a malformed hash", JSON.stringify({ sha1: "xyz" })],
  ])("skips the check for %s", async (_label, body) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await post(body);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      compromised: false,
      skipped: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes the hash and sends only its prefix upstream", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(`${SUFFIX}:3\r\nABCDE:1`));
    vi.stubGlobal("fetch", fetchMock);

    const response = await post(
      JSON.stringify({ sha1: ` ${SHA1.toLowerCase()} ` })
    );

    await expect(response.json()).resolves.toEqual({
      compromised: true,
      skipped: false,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.pwnedpasswords.com/range/${SHA1.slice(0, 5)}`
    );
  });
});
