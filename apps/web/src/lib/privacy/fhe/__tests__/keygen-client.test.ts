import { beforeEach, describe, expect, it, vi } from "vitest";

const recordMetric = vi.fn();
vi.mock("@/lib/observability/client-metrics", () => ({
  recordClientMetric: recordMetric,
}));

describe("keygen-client", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let onmessageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    onmessageHandler = null;
    postMessageSpy = vi.fn();

    vi.stubGlobal(
      "Worker",
      class MockWorker {
        postMessage = postMessageSpy;
        onerror: ((event: Event) => void) | null = null;

        get onmessage() {
          return onmessageHandler;
        }

        set onmessage(handler: ((event: MessageEvent) => void) | null) {
          onmessageHandler = handler;
        }
      }
    );
  });

  it("sends init message on prewarm", async () => {
    const { prewarmTfheWorker } = await import(
      "@/lib/privacy/fhe/keygen-client"
    );

    prewarmTfheWorker();

    expect(postMessageSpy).toHaveBeenCalledWith({ type: "init" });
  });

  it("sends init message only once across multiple prewarm calls", async () => {
    const { prewarmTfheWorker } = await import(
      "@/lib/privacy/fhe/keygen-client"
    );

    prewarmTfheWorker();
    prewarmTfheWorker();
    prewarmTfheWorker();

    const initCalls = postMessageSpy.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).type === "init"
    );
    expect(initCalls).toHaveLength(1);
  });

  it("records metric on init_complete response", async () => {
    const { prewarmTfheWorker } = await import(
      "@/lib/privacy/fhe/keygen-client"
    );

    prewarmTfheWorker();

    onmessageHandler?.({
      data: {
        type: "init_complete",
        crossOriginIsolated: true,
        threads: 8,
        durationMs: 1500,
      },
    } as MessageEvent);

    expect(recordMetric).toHaveBeenCalledWith({
      name: "client.tfhe.init",
      value: 1500,
      attributes: {
        result: "ok",
        crossOriginIsolated: true,
        threads: 8,
      },
    });
  });

  it("generates keys after init", async () => {
    const { prewarmTfheWorker, generateFheKeyMaterialInWorker } = await import(
      "@/lib/privacy/fhe/keygen-client"
    );

    prewarmTfheWorker();

    const genPromise = generateFheKeyMaterialInWorker();

    // Verify generate_key_material message was sent
    const genCall = postMessageSpy.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).type === "generate_key_material"
    );
    expect(genCall).toBeDefined();
    const genId = (genCall?.[0] as Record<string, unknown>).id;

    // Simulate worker response
    const storedKeys = {
      clientKey: new Uint8Array([1, 2, 3]),
      publicKey: new Uint8Array([4, 5, 6]),
      serverKey: new Uint8Array([7, 8, 9]),
      createdAt: "2026-03-17T00:00:00Z",
    };

    onmessageHandler?.({
      data: { id: genId, type: "result", storedKeys, durationMs: 5000 },
    } as MessageEvent);

    const result = await genPromise;
    expect(result.durationMs).toBe(5000);
    expect(result.storedKeys.clientKey).toEqual(new Uint8Array([1, 2, 3]));
  });
});
