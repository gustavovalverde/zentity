import { beforeEach, describe, expect, it } from "vitest";

import { resetDatabase } from "@/test-utils/db-test-utils";

interface CapabilityRecord {
  approval_strength: string;
  description: string;
  grantable: boolean;
  input_schema: {
    properties?: {
      fields?: {
        items?: {
          enum?: string[];
        };
      };
    };
    required?: string[];
  } | null;
  name: string;
  output_schema: {
    properties?: {
      email?: {
        type?: string[];
      };
    };
  } | null;
}

describe("GET /api/auth/agent/capabilities", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("publishes my_profile and whoami contracts that match the MCP server", async () => {
    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);

    const capabilities = (await response.json()) as CapabilityRecord[];

    const myProfile = capabilities.find(
      (capability) => capability.name === "my_profile"
    );
    expect(myProfile?.description).not.toContain("email");
    expect(myProfile?.input_schema?.properties?.fields?.items?.enum).toEqual([
      "name",
      "address",
      "birthdate",
    ]);
    expect(myProfile?.input_schema?.required).toEqual(["fields"]);

    const whoami = capabilities.find(
      (capability) => capability.name === "whoami"
    );
    expect(whoami?.description).toContain("granted scopes include email");
    expect(whoami?.output_schema?.properties?.email?.type).toEqual([
      "string",
      "null",
    ]);
  });

  // R7: the catalog names what user verification proves, not "biometric".
  it("publishes each capability's manual ceremony and whether a grant may approve it", async () => {
    const { GET } = await import("./route");
    const capabilities = (await (await GET()).json()) as CapabilityRecord[];

    expect(
      Object.fromEntries(
        capabilities.map((capability) => [
          capability.name,
          {
            approval_strength: capability.approval_strength,
            grantable: capability.grantable,
          },
        ])
      )
    ).toEqual({
      check_compliance: { approval_strength: "session", grantable: true },
      my_profile: { approval_strength: "session", grantable: false },
      my_proofs: { approval_strength: "session", grantable: true },
      "payment_authorization:sign": {
        approval_strength: "user_verification",
        grantable: true,
      },
      purchase: { approval_strength: "user_verification", grantable: false },
      whoami: { approval_strength: "session", grantable: true },
    });
  });

  it("publishes one capability with the same fields", async () => {
    const { GET } = await import("./[name]/route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ name: "purchase" }),
    });

    expect(await response.json()).toEqual(
      expect.objectContaining({
        approval_strength: "user_verification",
        grantable: false,
        name: "purchase",
      })
    );
  });
});
