// @vitest-environment jsdom

import type { FhevmProviderFactory } from "..";

import { describe, expect, it, vi } from "vitest";

describe("fhevm provider registry", () => {
  it("resolves built-in providers", async () => {
    const { resolveFhevmProviderFactory } = await import("..");

    const zama = resolveFhevmProviderFactory("zama");
    const mock = resolveFhevmProviderFactory("mock");

    expect(zama).toBeTypeOf("function");
    expect(mock).toBeTypeOf("function");
  });

  it("returns undefined for unknown providers", async () => {
    const { resolveFhevmProviderFactory } = await import("..");

    const unknown = resolveFhevmProviderFactory("does-not-exist");
    expect(unknown).toBeUndefined();
  });

  it("registers custom providers", async () => {
    const { registerFhevmProvider, resolveFhevmProviderFactory } = await import(
      ".."
    );

    const factory: FhevmProviderFactory = () => {
      throw new Error("test provider should not be invoked");
    };

    registerFhevmProvider("test-provider", factory);

    const resolved = resolveFhevmProviderFactory("test-provider");
    expect(resolved).toBe(factory);
  });

  it("registers providers from window.__FHEVM_PROVIDER_FACTORIES__", async () => {
    const factory: FhevmProviderFactory = () => {
      throw new Error("test provider should not be invoked");
    };

    (
      globalThis.window as Window & {
        __FHEVM_PROVIDER_FACTORIES__?: Record<string, FhevmProviderFactory>;
      }
    ).__FHEVM_PROVIDER_FACTORIES__ = {
      injected: factory,
    };

    vi.resetModules();

    const { resolveFhevmProviderFactory } = await import("..");

    expect(resolveFhevmProviderFactory("injected")).toBe(factory);
  });
});
