import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { resetDatabase } from "@/test-utils/db-test-utils";

import { POST } from "./route";

const REGISTER_URL = "http://localhost:3000/api/auth/oauth2/register";
const RP_ORIGIN = "https://demo-rp.example";

describe("POST /api/auth/oauth2/register", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
  });

  async function register(metadata: Record<string, unknown>) {
    const response = await POST(
      new Request(REGISTER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          ...metadata,
        }),
      })
    );
    const payload = (await response.json()) as {
      client_id?: string;
      error?: string;
    };
    const client = payload.client_id
      ? await db.query.oauthClients.findFirst({
          where: eq(oauthClients.clientId, payload.client_id),
        })
      : undefined;
    return { status: response.status, payload, client };
  }

  it("registers loopback-only clients without application_type as native", async () => {
    const { status, client } = await register({
      client_name: "MCP Inspector",
      client_uri: "https://github.com/modelcontextprotocol/inspector",
      redirect_uris: [
        "http://localhost:6274/oauth/callback",
        "http://localhost:6274/oauth/callback/debug",
      ],
    });

    expect(status).toBe(201);
    expect(client?.applicationType).toBe("native");
  });

  it("registers loopback IP redirects without application_type as native", async () => {
    const { status, client } = await register({
      client_name: "CLI",
      redirect_uris: ["http://127.0.0.1:47123/callback"],
    });

    expect(status).toBe(201);
    expect(client?.applicationType).toBe("native");
  });

  it("keeps web defaults for clients that are not loopback-only", async () => {
    const web = await register({
      client_name: "Web RP",
      redirect_uris: [`${RP_ORIGIN}/callback`],
    });
    const mixed = await register({
      client_name: "Mixed RP",
      redirect_uris: [
        `${RP_ORIGIN}/callback`,
        "http://localhost:4000/callback",
      ],
    });

    expect(web.status).toBe(201);
    expect(web.client?.applicationType).toBe("web");
    expect(mixed.status).toBe(400);
    expect(mixed.payload.error).toBe("invalid_redirect_uri");
  });

  it("rejects loopback redirects for clients that declare themselves web", async () => {
    const { status, payload } = await register({
      application_type: "web",
      client_name: "Web RP",
      redirect_uris: ["http://localhost:4000/callback"],
    });

    expect(status).toBe(400);
    expect(payload.error).toBe("invalid_redirect_uri");
  });
  it.each([
    "https://10.0.0.5/validity",
    "https://172.20.1.1/validity",
    "https://192.168.1.10/validity",
    "https://169.254.169.254/latest/meta-data",
    "https://[fd12:3456::1]/validity",
    "https://[::ffff:10.0.0.5]/validity",
    "https://167772165/validity",
    "https://012.0.0.5/validity",
    "https://fhe.railway.internal/validity",
    "https://metadata.google.internal/validity",
    "http://demo-rp.example/validity",
  ])("rejects rp_validity_notice_uri %s", async (uri) => {
    const { status, payload, client } = await register({
      client_name: "Internal Probe",
      redirect_uris: [`${RP_ORIGIN}/callback`],
      rp_validity_notice_uri: uri,
    });

    expect(status).toBe(400);
    expect(payload.error).toBe("invalid_client_metadata");
    expect(client).toBeUndefined();
  });

  it("rejects loopback rp_validity_notice_uri in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { status, client } = await register({
      client_name: "Loopback Probe",
      redirect_uris: [`${RP_ORIGIN}/callback`],
      rp_validity_notice_uri: "https://127.0.0.1/validity",
    });

    expect(status).toBe(400);
    expect(client).toBeUndefined();
  });

  it("rejects an internal backchannel_client_notification_endpoint", async () => {
    const { status, payload } = await register({
      client_name: "Ping Probe",
      redirect_uris: [`${RP_ORIGIN}/callback`],
      backchannel_client_notification_endpoint:
        "https://ocr.railway.internal:5004/notify",
    });

    expect(status).toBe(400);
    expect(payload.error).toBe("invalid_client_metadata");
  });
});
