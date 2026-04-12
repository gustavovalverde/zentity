import { beforeEach, describe, expect, it, vi } from "vitest";

const recordMetric = vi.fn();
vi.mock("@/lib/observability/client-metrics", () => ({
  recordClientMetric: recordMetric,
}));

const generateFheKeyMaterialInWorker = vi.fn();
const prewarmTfheWorker = vi.fn();
vi.mock("@/lib/privacy/fhe/keygen-client", () => ({
  generateFheKeyMaterialInWorker,
  prewarmTfheWorker,
}));

const fetchMsgpack = vi.fn();
vi.mock("@/lib/utils/binary-transport", () => ({
  fetchMsgpack,
}));

const mockStoredKeys = {
  clientKey: new Uint8Array([1, 2, 3]),
  publicKey: new Uint8Array([4, 5, 6]),
  serverKey: new Uint8Array([7, 8, 9]),
  createdAt: "2026-03-17T00:00:00Z",
};

describe("background-keygen", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    generateFheKeyMaterialInWorker.mockResolvedValue({
      storedKeys: mockStoredKeys,
      durationMs: 30_000,
    });
    fetchMsgpack.mockResolvedValue({ keyId: "test-key-id" });
  });

  it("is idempotent — second call is a no-op", async () => {
    const { startBackgroundKeygen, getPreGeneratedKeys } = await import(
      "@/lib/privacy/fhe/background-keygen"
    );

    startBackgroundKeygen();
    startBackgroundKeygen();

    const result = await getPreGeneratedKeys();

    expect(generateFheKeyMaterialInWorker).toHaveBeenCalledOnce();
    expect(result).not.toBeNull();
    expect(result?.keyId).toBe("test-key-id");
  });

  it("returns cached result on success", async () => {
    const { startBackgroundKeygen, getPreGeneratedKeys } = await import(
      "@/lib/privacy/fhe/background-keygen"
    );

    startBackgroundKeygen();
    const result = await getPreGeneratedKeys();

    expect(result).toEqual({
      storedKeys: mockStoredKeys,
      keyId: "test-key-id",
    });
  });

  it("consume-once — second getPreGeneratedKeys returns null", async () => {
    const { startBackgroundKeygen, getPreGeneratedKeys } = await import(
      "@/lib/privacy/fhe/background-keygen"
    );

    startBackgroundKeygen();
    const first = await getPreGeneratedKeys();
    const second = await getPreGeneratedKeys();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("reset clears state and allows restart", async () => {
    const {
      startBackgroundKeygen,
      getPreGeneratedKeys,
      resetBackgroundKeygen,
    } = await import("@/lib/privacy/fhe/background-keygen");

    startBackgroundKeygen();
    await getPreGeneratedKeys();

    resetBackgroundKeygen();
    startBackgroundKeygen();
    const result = await getPreGeneratedKeys();

    expect(result).not.toBeNull();
    expect(generateFheKeyMaterialInWorker).toHaveBeenCalledTimes(2);
  });

  it("returns null on keygen failure", async () => {
    generateFheKeyMaterialInWorker.mockRejectedValue(
      new Error("WASM load failed")
    );

    const { startBackgroundKeygen, getPreGeneratedKeys } = await import(
      "@/lib/privacy/fhe/background-keygen"
    );

    startBackgroundKeygen();
    const result = await getPreGeneratedKeys();

    expect(result).toBeNull();
  });

  it("returns null on registration failure", async () => {
    fetchMsgpack.mockRejectedValue(new Error("FHE service unavailable"));

    const { startBackgroundKeygen, getPreGeneratedKeys } = await import(
      "@/lib/privacy/fhe/background-keygen"
    );

    startBackgroundKeygen();
    const result = await getPreGeneratedKeys();

    expect(result).toBeNull();
  });

  it("records duration metric on success", async () => {
    const { startBackgroundKeygen, getPreGeneratedKeys } = await import(
      "@/lib/privacy/fhe/background-keygen"
    );

    startBackgroundKeygen();
    await getPreGeneratedKeys();

    expect(recordMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "client.tfhe.bg_keygen.duration",
        attributes: { result: "ok", source: "background" },
      })
    );
  });
});
