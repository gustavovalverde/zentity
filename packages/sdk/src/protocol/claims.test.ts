import type {
	AccessTokenActClaim,
	AccessTokenClaims,
	AgentAuthorization,
	OversightMethod,
} from "./claims";

import { describe, expectTypeOf, it } from "vitest";

// R7: the method names what user verification proves, never "biometric".
describe("OversightMethod", () => {
  it("names the three recorded approval methods", () => {
    expectTypeOf<OversightMethod>().toEqualTypeOf<
      "capability_grant" | "session" | "user_verification"
    >();
  });
});

// R11: the SDK types expose no raw session, host, or key identifier.
describe("AccessTokenActClaim", () => {
	it("is the pairwise actor and its profile only", () => {
		expectTypeOf<AccessTokenActClaim>().toEqualTypeOf<{
			sub: string;
			sub_profile?: "service";
		}>();
		expectTypeOf<AccessTokenActClaim>().not.toHaveProperty("session_id");
		expectTypeOf<AccessTokenActClaim>().not.toHaveProperty("host_id");
		expectTypeOf<AccessTokenActClaim>().not.toHaveProperty("did");
	});
});

describe("AccessTokenClaims", () => {
	it("carries no agent control-plane claim", () => {
		expectTypeOf<AccessTokenClaims>().not.toHaveProperty("capabilities");
		expectTypeOf<AccessTokenClaims>().not.toHaveProperty("oversight");
		expectTypeOf<AccessTokenClaims>().not.toHaveProperty("delegation");
		expectTypeOf<AccessTokenClaims>().not.toHaveProperty("task");
		expectTypeOf<AccessTokenClaims>().not.toHaveProperty("audit");
	});
});

describe("AgentAuthorization", () => {
	it("is what the token response adds for a verified agent", () => {
		expectTypeOf<keyof AgentAuthorization>().toEqualTypeOf<
			"aap_claims_version" | "capabilities" | "delegation" | "oversight"
		>();
		expectTypeOf<AgentAuthorization["delegation"]>().toEqualTypeOf<{
			depth: number;
			max_depth: number;
		}>();
	});
});
