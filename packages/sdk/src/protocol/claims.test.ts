import type { OversightMethod } from "./claims";

import { describe, expectTypeOf, it } from "vitest";

// R7: the method names what user verification proves, never "biometric".
describe("OversightMethod", () => {
  it("names the three recorded approval methods", () => {
    expectTypeOf<OversightMethod>().toEqualTypeOf<
      "capability_grant" | "session" | "user_verification"
    >();
  });
});
