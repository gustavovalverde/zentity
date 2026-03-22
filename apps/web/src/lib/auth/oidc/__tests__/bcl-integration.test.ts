import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { jwks as jwksTable } from "@/lib/db/schema/jwks";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const BCL_URI = "https://rp.example.com/backchannel-logout";
const BCL_CLIENT_ID = "bcl-test-client";

async function seedSigningKey() {
  const { generateKeyPair, exportJWK } = await import("jose");
  const keyPair = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const kid = crypto.randomUUID();
  const publicJwk = await exportJWK(keyPair.publicKey);
  const privateJwk = await exportJWK(keyPair.privateKey);
  await db
    .insert(jwksTable)
    .values({
      id: kid,
      publicKey: JSON.stringify(publicJwk),
      privateKey: JSON.stringify(privateJwk),
      alg: "EdDSA",
      crv: "Ed25519",
    })
    .run();
}

async function createBclClient(
  clientId: string,
  metadata: Record<string, unknown>
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "BCL Test Client",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      metadata: JSON.stringify(metadata),
    })
    .run();
}

describe("back-channel logout", () => {
  let userId: string;
  const fetchSpy = vi.fn<typeof fetch>();

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await seedSigningKey();

    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers logout token to BCL-registered client", async () => {
    await createBclClient(BCL_CLIENT_ID, {
      backchannel_logout_uri: BCL_URI,
    });

    const { sendBackchannelLogout } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await sendBackchannelLogout(userId);

    expect(fetchSpy).toHaveBeenCalledWith(
      BCL_URI,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("logout token has correct JWT structure", async () => {
    await createBclClient(BCL_CLIENT_ID, {
      backchannel_logout_uri: BCL_URI,
    });

    const { sendBackchannelLogout } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await sendBackchannelLogout(userId);

    const body = fetchSpy.mock.calls[0]?.[1]?.body as string;
    const params = new URLSearchParams(body);
    const logoutToken = params.get("logout_token");
    expect(logoutToken).toBeTruthy();

    const payload = decodeJwt(logoutToken as string);
    expect(payload.iss).toBeTruthy();
    expect(payload.sub).toBe(userId);
    expect(payload.aud).toBe(BCL_CLIENT_ID);
    expect(payload.iat).toBeTypeOf("number");
    expect(payload.jti).toBeTruthy();
    expect(payload.events).toEqual({
      "http://schemas.openid.net/event/backchannel-logout": {},
    });
  });

  it("includes sid when backchannel_logout_session_required", async () => {
    await createBclClient(BCL_CLIENT_ID, {
      backchannel_logout_uri: BCL_URI,
      backchannel_logout_session_required: true,
    });

    const sessionId = crypto.randomUUID();
    const { sendBackchannelLogout } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await sendBackchannelLogout(userId, sessionId);

    const body = fetchSpy.mock.calls[0]?.[1]?.body as string;
    const params = new URLSearchParams(body);
    const payload = decodeJwt(params.get("logout_token") as string);
    expect(payload.sid).toBe(sessionId);
  });

  it("omits sid when session_required is false", async () => {
    await createBclClient(BCL_CLIENT_ID, {
      backchannel_logout_uri: BCL_URI,
    });

    const { sendBackchannelLogout } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await sendBackchannelLogout(userId, "session-123");

    const body = fetchSpy.mock.calls[0]?.[1]?.body as string;
    const params = new URLSearchParams(body);
    const payload = decodeJwt(params.get("logout_token") as string);
    expect(payload.sid).toBeUndefined();
  });

  it("skips clients without backchannel_logout_uri", async () => {
    await createBclClient("no-bcl-client", {});

    const { sendBackchannelLogout } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await sendBackchannelLogout(userId);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("jti is unique across multiple logout events", async () => {
    await createBclClient(BCL_CLIENT_ID, {
      backchannel_logout_uri: BCL_URI,
    });

    const { sendBackchannelLogout } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await sendBackchannelLogout(userId);
    await sendBackchannelLogout(userId);

    const getJti = (callIndex: number) => {
      const body = fetchSpy.mock.calls[callIndex]?.[1]?.body as string;
      const params = new URLSearchParams(body);
      return decodeJwt(params.get("logout_token") as string).jti;
    };

    expect(getJti(0)).not.toBe(getJti(1));
  });

  it("revokePendingCibaOnLogout rejects pending CIBA requests", async () => {
    const authReqId = crypto.randomUUID();
    await createBclClient(BCL_CLIENT_ID, {});
    await db
      .insert(cibaRequests)
      .values({
        authReqId,
        clientId: BCL_CLIENT_ID,
        userId,
        scope: "openid",
        status: "pending",
        expiresAt: new Date(Date.now() + 300_000),
      })
      .run();

    const { revokePendingCibaOnLogout } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await revokePendingCibaOnLogout(userId);

    const row = await db
      .select({ status: cibaRequests.status })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, authReqId))
      .get();
    expect(row?.status).toBe("rejected");
  });

  it("revokePendingCibaOnLogout does not affect non-pending requests", async () => {
    const approvedId = crypto.randomUUID();
    await createBclClient(BCL_CLIENT_ID, {});
    await db
      .insert(cibaRequests)
      .values({
        authReqId: approvedId,
        clientId: BCL_CLIENT_ID,
        userId,
        scope: "openid",
        status: "approved",
        expiresAt: new Date(Date.now() + 300_000),
      })
      .run();

    const { revokePendingCibaOnLogout } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await revokePendingCibaOnLogout(userId);

    const row = await db
      .select({ status: cibaRequests.status })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, approvedId))
      .get();
    expect(row?.status).toBe("approved");
  });
});
