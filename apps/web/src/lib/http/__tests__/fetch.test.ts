import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchJson, HttpError, isTimeoutError } from "../fetch";

function hangUntilAborted(_url: string, init: RequestInit) {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });
}

describe("fetchJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the response body on an HttpError when the JSON is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>oops</html>"))
    );

    const error = (await fetchJson("http://svc.local/x").catch(
      (e) => e
    )) as HttpError;

    expect(error).toBeInstanceOf(HttpError);
    expect(error.message).toBe("Invalid JSON response");
    expect(error.bodyText).toBe("<html>oops</html>");
  });

  it("rejects with a TimeoutError when the request exceeds timeoutMs", async () => {
    vi.stubGlobal("fetch", vi.fn(hangUntilAborted));

    const error = await fetchJson("http://svc.local/x", {
      timeoutMs: 10,
    }).catch((e) => e);

    expect(isTimeoutError(error)).toBe(true);
  });

  it("honors a caller-supplied abort signal", async () => {
    vi.stubGlobal("fetch", vi.fn(hangUntilAborted));
    const controller = new AbortController();

    const pending = fetchJson("http://svc.local/x", {
      signal: controller.signal,
    }).catch((e) => e);
    controller.abort(new Error("cancelled"));

    const error = await pending;
    expect(error).toEqual(new Error("cancelled"));
    expect(isTimeoutError(error)).toBe(false);
  });
});
