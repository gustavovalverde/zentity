/// <reference lib="webworker" />

interface WorkerRequest {
  id: number;
  type: "generate_key_material";
}

interface WorkerSuccess {
  id: number;
  type: "result";
  storedKeys: {
    clientKey: Uint8Array;
    publicKey: Uint8Array;
    serverKey: Uint8Array;
    createdAt: string;
  };
  publicKeyB64: string;
  serverKeyB64: string;
  durationMs: number;
}

interface WorkerError {
  id: number;
  type: "error";
  message: string;
}

interface TfheClientKey {
  serialize(): Uint8Array;
}

interface TfheCompressedPublicKey {
  serialize(): Uint8Array;
}

interface TfheCompressedServerKey {
  serialize(): Uint8Array;
}

interface TfheConfigBuilder {
  build(): unknown;
}

interface TfheModuleStatic {
  default(wasmPath?: string): Promise<unknown>;
  initThreadPool(threads: number): Promise<void>;
  init_panic_hook(): void;
  TfheConfigBuilder: {
    default(): TfheConfigBuilder;
  };
  TfheClientKey: {
    generate(config: unknown): TfheClientKey;
  };
  TfheCompressedPublicKey: {
    new: (clientKey: TfheClientKey) => TfheCompressedPublicKey;
  };
  TfheCompressedServerKey: {
    new: (clientKey: TfheClientKey) => TfheCompressedServerKey;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TfheModule = TfheModuleStatic;

let tfheInitPromise: Promise<TfheModule> | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x80_00;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function loadTfhe(): Promise<TfheModule> {
  if (!tfheInitPromise) {
    tfheInitPromise = (async () => {
      const tfheUrl = "/tfhe/tfhe.js";
      const tfhe = (await import(
        /* webpackIgnore: true */
        /* @vite-ignore */
        tfheUrl
      )) as TfheModule;

      await tfhe.default();

      if (self.crossOriginIsolated) {
        const threads = navigator.hardwareConcurrency || 4;
        try {
          await tfhe.initThreadPool(threads);
        } catch {
          // Thread pool init can fail; continue single-threaded in worker.
        }
      }

      try {
        tfhe.init_panic_hook();
      } catch {
        // Optional
      }

      return tfhe;
    })();
  }

  return tfheInitPromise;
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (!message || message.type !== "generate_key_material") {
    return;
  }

  const start = performance.now();

  try {
    const tfhe = await loadTfhe();
    const config = tfhe.TfheConfigBuilder.default().build();
    const clientKey = tfhe.TfheClientKey.generate(config);
    const publicKey = tfhe.TfheCompressedPublicKey.new(clientKey);
    const serverKey = tfhe.TfheCompressedServerKey.new(clientKey);

    const storedKeys = {
      clientKey: clientKey.serialize(),
      publicKey: publicKey.serialize(),
      serverKey: serverKey.serialize(),
      createdAt: new Date().toISOString(),
    };

    const response: WorkerSuccess = {
      id: message.id,
      type: "result",
      storedKeys,
      publicKeyB64: bytesToBase64(storedKeys.publicKey),
      serverKeyB64: bytesToBase64(storedKeys.serverKey),
      durationMs: performance.now() - start,
    };

    self.postMessage(response, [
      storedKeys.clientKey.buffer,
      storedKeys.publicKey.buffer,
      storedKeys.serverKey.buffer,
    ]);
  } catch (error) {
    const response: WorkerError = {
      id: message.id,
      type: "error",
      message:
        error instanceof Error ? error.message : "Failed to generate FHE keys",
    };
    self.postMessage(response);
  }
});
