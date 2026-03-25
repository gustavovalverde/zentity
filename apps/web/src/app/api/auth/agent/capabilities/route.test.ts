import { beforeEach, describe, expect, it } from "vitest";

import { resetDatabase } from "@/test/db-test-utils";

interface CapabilityRecord {
  description: string;
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
});
