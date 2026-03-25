import { beforeEach, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth";
import { resetDatabase } from "@/test/db-test-utils";

const REGISTER_URL = "http://localhost:3000/api/auth/oauth2/register";

function buildRegistrationRequest(scope: string) {
  return new Request(REGISTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_name: "Installed Agent",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: ["http://127.0.0.1/callback"],
      response_types: ["code"],
      scope,
      token_endpoint_auth_method: "none",
    }),
  });
}

describe("dynamic client registration scopes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("allows installed-agent registration to request offline_access", async () => {
    const response = await auth.handler(
      buildRegistrationRequest("openid email offline_access")
    );
    const text = await response.text();

    expect(response.status).toBeLessThan(400);
    expect(JSON.parse(text)).toEqual(
      expect.objectContaining({
        client_id: expect.any(String),
      })
    );
  });

  it("allows installed-agent registration to request identity and proof scopes used by MCP tools", async () => {
    const response = await auth.handler(
      buildRegistrationRequest(
        "openid email offline_access identity.name identity.address identity.dob proof:identity proof:age proof:nationality"
      )
    );
    const text = await response.text();

    expect(response.status).toBeLessThan(400);
    expect(JSON.parse(text)).toEqual(
      expect.objectContaining({
        client_id: expect.any(String),
      })
    );
  });

  it("rejects compliance:key:read for dynamically registered clients", async () => {
    const response = await auth.handler(
      buildRegistrationRequest(
        "openid email offline_access compliance:key:read"
      )
    );
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual(
      expect.objectContaining({
        error: "invalid_scope",
      })
    );
    expect(text).toContain("compliance:key:read");
  });
});
