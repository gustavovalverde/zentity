import { describe, expect, it } from "vitest";

import { resolveOversightMethod } from "@/lib/agents/claims";

// R5: oversight states the recorded method, never a ranking of the method
// against the capability's catalog strength.
describe("resolveOversightMethod", () => {
  it.each(["capability_grant", "session", "user_verification"] as const)(
    "states the recorded %s method as is",
    (method) => {
      expect(resolveOversightMethod(method)).toBe(method);
    }
  );

  it.each([null, undefined, "", "user", "biometric", "email", "none"])(
    "states no method for %j, which no approval records",
    (method) => {
      expect(resolveOversightMethod(method)).toBeNull();
    }
  );
});
