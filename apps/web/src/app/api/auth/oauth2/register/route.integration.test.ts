import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { listBackchannelLogoutClients } from "@/lib/auth/oidc/backchannel-logout";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { listRpValidityNoticeClients } from "@/lib/identity/validity/rp-notice";
import { resetDatabase } from "@/test-utils/db-test-utils";

import { POST } from "./route";

const REGISTER_URL = "http://localhost:3000/api/auth/oauth2/register";

describe("POST /api/auth/oauth2/register", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("persists backchannel logout and validity notice registrations", async () => {
    const response = await POST(
      new Request(REGISTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          backchannel_logout_session_required: true,
          backchannel_logout_uri:
            "http://localhost:3102/api/auth/backchannel-logout",
          client_name: "Demo RP",
          grant_types: ["authorization_code", "refresh_token"],
          redirect_uris: ["http://127.0.0.1/callback"],
          response_types: ["code"],
          rp_validity_notice_enabled: true,
          rp_validity_notice_uri: "http://localhost:3102/api/auth/validity",
          scope: "openid email offline_access",
          token_endpoint_auth_method: "none",
        }),
      })
    );
    const payload = (await response.json()) as { client_id?: string };

    expect(response.status).toBe(200);
    expect(payload.client_id).toEqual(expect.any(String));

    const client = await db.query.oauthClients.findFirst({
      where: eq(oauthClients.clientId, payload.client_id ?? ""),
    });

    expect(client).toMatchObject({
      clientId: payload.client_id,
      enableEndSession: true,
      rpValidityNoticeEnabled: true,
      rpValidityNoticeUri: "http://localhost:3102/api/auth/validity",
    });
    expect(client?.metadata).toEqual(expect.any(String));
    expect(JSON.parse(client?.metadata ?? "{}")).toMatchObject({
      backchannel_logout_session_required: true,
      backchannel_logout_uri:
        "http://localhost:3102/api/auth/backchannel-logout",
      rp_validity_notice_enabled: true,
      rp_validity_notice_uri: "http://localhost:3102/api/auth/validity",
    });

    await expect(listBackchannelLogoutClients()).resolves.toEqual([
      expect.objectContaining({
        backchannelLogoutSessionRequired: true,
        backchannelLogoutUri:
          "http://localhost:3102/api/auth/backchannel-logout",
        clientId: payload.client_id,
      }),
    ]);
    await expect(listRpValidityNoticeClients()).resolves.toEqual([
      expect.objectContaining({
        clientId: payload.client_id,
        rpValidityNoticeUri: "http://localhost:3102/api/auth/validity",
      }),
    ]);
  });
});
