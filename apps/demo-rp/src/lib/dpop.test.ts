// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const STABLE_SEED = "abcdefghijklmnopqrstuvwxyz012345";

const envState: { ZPAY_DPOP_KEY_SEED: string | undefined } = {
  ZPAY_DPOP_KEY_SEED: undefined,
};

vi.mock("@/lib/env", () => ({
  env: new Proxy(
    {},
    {
      get: (_target, key: string) => {
        if (key === "ZPAY_DPOP_KEY_SEED") {
          return envState.ZPAY_DPOP_KEY_SEED;
        }
        return undefined;
      },
    }
  ),
}));

async function loadDpopWithEnv(
  values: Record<string, string | undefined>
): Promise<typeof import("./dpop")> {
  envState.ZPAY_DPOP_KEY_SEED = values.ZPAY_DPOP_KEY_SEED;
  vi.resetModules();
  return await import("./dpop");
}

describe("getDpopJkt", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("derives the same JKT across calls when ZPAY_DPOP_KEY_SEED is set", async () => {
    const mod = await loadDpopWithEnv({ ZPAY_DPOP_KEY_SEED: STABLE_SEED });
    const a = await mod.getDpopJkt();
    const b = await mod.getDpopJkt();
    expect(a).toBe(b);
    expect(a).toHaveLength(43);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("derives the same JKT across fresh module loads when the seed is stable", async () => {
    const first = await loadDpopWithEnv({ ZPAY_DPOP_KEY_SEED: STABLE_SEED });
    const firstJkt = await first.getDpopJkt();
    const second = await loadDpopWithEnv({ ZPAY_DPOP_KEY_SEED: STABLE_SEED });
    const secondJkt = await second.getDpopJkt();
    expect(secondJkt).toBe(firstJkt);
  });

  it("derives a different JKT when the seed changes", async () => {
    const a = await loadDpopWithEnv({ ZPAY_DPOP_KEY_SEED: STABLE_SEED });
    const ajkt = await a.getDpopJkt();
    const b = await loadDpopWithEnv({
      ZPAY_DPOP_KEY_SEED: `${STABLE_SEED}-distinct-suffix-padding-bytes-32`,
    });
    const bjkt = await b.getDpopJkt();
    expect(bjkt).not.toBe(ajkt);
  });

  it("generates ephemeral keys and warns when ZPAY_DPOP_KEY_SEED is unset", async () => {
    const first = await loadDpopWithEnv({ ZPAY_DPOP_KEY_SEED: undefined });
    const firstJkt = await first.getDpopJkt();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("ZPAY_DPOP_KEY_SEED unset");

    const second = await loadDpopWithEnv({ ZPAY_DPOP_KEY_SEED: undefined });
    const secondJkt = await second.getDpopJkt();
    expect(secondJkt).not.toBe(firstJkt);
  });
});

describe("signDpopProof", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("signs proofs that carry the deterministic JKT in the header", async () => {
    const mod = await loadDpopWithEnv({ ZPAY_DPOP_KEY_SEED: STABLE_SEED });
    const { proofJwt, jkt } = await mod.signDpopProof({
      method: "POST",
      url: "http://127.0.0.1:8080/x402/v2/prepare",
      jti: "jti-test-1",
    });
    expect(jkt).toBe(await mod.getDpopJkt());
    const [headerB64] = proofJwt.split(".");
    expect(headerB64).toBeTruthy();
    const decoded = JSON.parse(
      Buffer.from(
        (headerB64 as string).replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf8")
    );
    expect(decoded.typ).toBe("dpop+jwt");
    expect(decoded.alg).toBe("ES256");
    expect(decoded.jwk.crv).toBe("P-256");
  });
});
