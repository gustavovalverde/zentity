import type { FhevmProviderFactory } from "@/lib/privacy/fhe/providers/types";

import { describe, expect, it } from "vitest";

import {
  registerFhevmProvider,
  resolveFhevmProviderFactory,
} from "@/lib/privacy/fhe/providers/registry";

describe("fhevm provider registry", () => {
  it("resolves built-in providers", () => {
    const zama = resolveFhevmProviderFactory("zama");
    const mock = resolveFhevmProviderFactory("mock");

    expect(zama).toBeTypeOf("function");
    expect(mock).toBeTypeOf("function");
  });

  it("returns undefined for unknown providers", () => {
    const unknown = resolveFhevmProviderFactory("does-not-exist");
    expect(unknown).toBeUndefined();
  });

  it("registers custom providers", () => {
    const factory: FhevmProviderFactory = () => {
      throw new Error("test provider should not be invoked");
    };

    registerFhevmProvider("test-provider", factory);

    const resolved = resolveFhevmProviderFactory("test-provider");
    expect(resolved).toBe(factory);
  });
});
