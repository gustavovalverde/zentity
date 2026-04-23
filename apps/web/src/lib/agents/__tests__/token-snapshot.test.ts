import { describe, expect, it } from "vitest";

import { resolveOversightMethod } from "@/lib/agents/claims";

const OVERSIGHT_METHODS = [
  "capability_grant",
  "email",
  "session",
  "biometric",
] as const;

describe("resolveOversightMethod", () => {
  it("selects the strongest available oversight method", () => {
    for (const approvalMethod of OVERSIGHT_METHODS) {
      for (const approvalStrength of OVERSIGHT_METHODS) {
        expect(resolveOversightMethod(approvalMethod, approvalStrength)).toBe(
          OVERSIGHT_METHODS[
            Math.max(
              OVERSIGHT_METHODS.indexOf(approvalMethod),
              OVERSIGHT_METHODS.indexOf(approvalStrength)
            )
          ]
        );
      }
    }
  });

  it("falls back to session when stored metadata is absent or unknown", () => {
    expect(resolveOversightMethod(null, null)).toBe("session");
    expect(resolveOversightMethod("unknown", undefined)).toBe("session");
  });
});
