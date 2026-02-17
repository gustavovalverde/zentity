import { describe, expect, it } from "vitest";

import identityBindingArtifact from "@/noir-circuits/identity_binding/artifacts/identity_binding.json";

describe("identity_binding circuit artifact", () => {
  it("includes context-bound public inputs", () => {
    const artifact = identityBindingArtifact as {
      abi?: { parameters?: Array<{ name?: string; visibility?: string }> };
    };
    const parameters = artifact.abi?.parameters ?? [];
    const publicInputNames = new Set(
      parameters
        .filter((parameter) => parameter.visibility === "public")
        .map((parameter) => parameter.name)
    );

    expect(publicInputNames.has("msg_sender_hash")).toBe(true);
    expect(publicInputNames.has("audience_hash")).toBe(true);
    expect(publicInputNames.has("binding_commitment")).toBe(true);
  });
});
