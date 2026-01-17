// @vitest-environment jsdom

import type { FhevmProviderFactory } from "@/lib/fhevm/providers/types";

import { describe, expect, it, vi } from "vitest";

describe("fhevm provider global registry", () => {
  it("registers providers from globalThis.window.__FHEVM_PROVIDER_FACTORIES__", async () => {
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

    await import("@/lib/fhevm/providers/global");
    const { resolveFhevmProviderFactory } = await import(
      "@/lib/fhevm/providers/registry"
    );

    expect(resolveFhevmProviderFactory("injected")).toBe(factory);
  });
});
