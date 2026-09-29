import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { listBackchannelLogoutClients } from "@/lib/auth/oidc/backchannel-logout";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { listRpValidityNoticeClients } from "@/lib/identity/validity/rp-notice";
import { resetDatabase } from "@/test-utils/db-test-utils";

import { POST } from "./route";

const REGISTER_URL = "http://localhost:3000/api/auth/oauth2/register";
const RP_ORIGIN = "https://demo-rp.example";

describe("POST /api/auth/oauth2/register", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("persists logout and validity notice registrations", async () => {
    const response = await POST(
      new Request(REGISTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          backchannel_logout_session_required: true,
          backchannel_logout_uri: `${RP_ORIGIN}/api/auth/backchannel-logout`,
          client_name: "Demo RP",
          grant_types: ["authorization_code", "refresh_token"],
          post_logout_redirect_uris: [`${RP_ORIGIN}/bank`],
          redirect_uris: [`${RP_ORIGIN}/callback`],
          response_types: ["code"],
          rp_validity_notice_enabled: true,
          rp_validity_notice_uri: `${RP_ORIGIN}/api/auth/validity`,
          scope: "openid email offline_access",
          token_endpoint_auth_method: "none",
          zentity_protected_resource: "http://localhost:3300",
        }),
      })
    );
    const payload = (await response.json()) as { client_id?: string };

    // RFC 7591 §3.2.1: successful DCR returns 201 Created (oauth-provider 1.7).
    expect(response.status).toBe(201);
    expect(payload.client_id).toEqual(expect.any(String));

    const client = await db.query.oauthClients.findFirst({
      where: eq(oauthClients.clientId, payload.client_id ?? ""),
    });

    expect(client).toMatchObject({
      backchannelLogoutSessionRequired: true,
      backchannelLogoutUri: `${RP_ORIGIN}/api/auth/backchannel-logout`,
      clientId: payload.client_id,
      enableEndSession: true,
      rpValidityNoticeEnabled: true,
      rpValidityNoticeUri: `${RP_ORIGIN}/api/auth/validity`,
    });
    expect(JSON.parse(client?.metadata ?? "{}")).toMatchObject({
      rp_validity_notice_enabled: true,
      rp_validity_notice_uri: `${RP_ORIGIN}/api/auth/validity`,
      zentity_protected_resource: "http://localhost:3300",
    });

    await expect(listBackchannelLogoutClients()).resolves.toEqual([
      expect.objectContaining({
        backchannelLogoutSessionRequired: true,
        backchannelLogoutUri: `${RP_ORIGIN}/api/auth/backchannel-logout`,
        clientId: payload.client_id,
      }),
    ]);
    await expect(listRpValidityNoticeClients()).resolves.toEqual([
      expect.objectContaining({
        clientId: payload.client_id,
        rpValidityNoticeUri: `${RP_ORIGIN}/api/auth/validity`,
      }),
    ]);
  });
});
