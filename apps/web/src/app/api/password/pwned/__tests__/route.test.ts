import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../route";

const SHA1 = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";
const PREFIX = SHA1.slice(0, 5);
const SUFFIX = SHA1.slice(5);

const get = (query: string) =>
  GET(new Request(`http://localhost/api/password/pwned${query}`));

describe("password/pwned route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["a missing prefix", ""],
    ["a short prefix", "?prefix=5BAA"],
    ["a non-hex prefix", "?prefix=ZZZZZ"],
    ["a full SHA-1 hash", `?prefix=${SHA1}`],
    ["the legacy sha1 parameter", `?sha1=${SHA1}`],
  ])("rejects %s without calling upstream", async (_label, query) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await get(query);

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no longer exposes the hash-accepting POST handler", async () => {
    expect("POST" in (await import("../route"))).toBe(false);
  });

  it("relays the range for a prefix with padding and a cacheable response", async () => {
    const upstreamBody = `${SUFFIX}:3\r\nABCDE:0`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(upstreamBody));
    vi.stubGlobal("fetch", fetchMock);

    const response = await get(`?prefix=${PREFIX.toLowerCase()}`);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(upstreamBody);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(init.headers).toMatchObject({ "Add-Padding": "true" });
  });

  it("returns an uncached 502 when upstream answers with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 503 }))
    );

    const response = await get(`?prefix=${PREFIX}`);

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns an uncached 502 when upstream is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const response = await get(`?prefix=${PREFIX}`);

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
