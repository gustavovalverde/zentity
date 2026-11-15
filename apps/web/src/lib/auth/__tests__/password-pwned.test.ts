import { afterEach, describe, expect, it, vi } from "vitest";

import { checkPasswordPwned } from "../password";

// SHA-1("password")
const SHA1 = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";
const PREFIX = SHA1.slice(0, 5);
const SUFFIX = SHA1.slice(5);

function stubFetch(response: Response) {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("checkPasswordPwned", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends only the 5-character prefix and no credentials", async () => {
    const fetchMock = stubFetch(new Response(`${"A".repeat(35)}:1`));

    await checkPasswordPwned("password");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`/api/password/pwned?prefix=${PREFIX}`);
    expect(init.credentials).toBe("omit");
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("reports a match found locally in the returned range", async () => {
    stubFetch(new Response(`${"A".repeat(35)}:2\r\n${SUFFIX}:9\r\n`));

    await expect(checkPasswordPwned("password")).resolves.toEqual({
      compromised: true,
      skipped: false,
    });
  });

  it("ignores padded zero-count entries", async () => {
    stubFetch(new Response(`${SUFFIX}:0\r\n${"A".repeat(35)}:4`));

    await expect(checkPasswordPwned("password")).resolves.toEqual({
      compromised: false,
      skipped: false,
    });
  });

  it("reports a clean password when the suffix is absent", async () => {
    stubFetch(new Response(`${"A".repeat(35)}:4\r\n${"F".repeat(35)}:1`));

    await expect(checkPasswordPwned("password")).resolves.toEqual({
      compromised: false,
      skipped: false,
    });
  });

  it("skips the check when the relay fails", async () => {
    stubFetch(new Response(null, { status: 502 }));

    await expect(checkPasswordPwned("password")).resolves.toEqual({
      compromised: false,
      skipped: true,
    });
  });

  it("skips the check when a 200 response is not a range", async () => {
    stubFetch(new Response("<html>Sign in to continue</html>"));

    await expect(checkPasswordPwned("password")).resolves.toEqual({
      compromised: false,
      skipped: true,
    });
  });
});
