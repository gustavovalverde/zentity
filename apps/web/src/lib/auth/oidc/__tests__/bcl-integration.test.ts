import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashCibaAuthReqId } from "@/lib/auth/oidc/ciba-auth-req";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";

const BCL_URI = "https://rp.example.com/backchannel-logout";
const BCL_CLIENT_ID = "bcl-test-client";

async function createBclClient(
  clientId: string,
  backchannel: {
    backchannelLogoutSessionRequired?: boolean;
    backchannelLogoutUri?: string;
  } = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "BCL Test Client",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      ...backchannel,
    })
    .run();
}

async function sendLogout(sessionId?: string) {
  const { sendBackchannelLogoutToClient } = await import(
    "@/lib/auth/oidc/backchannel-logout"
  );
  await sendBackchannelLogoutToClient({
    clientId: BCL_CLIENT_ID,
    userId,
    ...(sessionId ? { sessionId } : {}),
  });
}

let userId: string;

describe("back-channel logout", () => {
  const fetchSpy = vi.fn<typeof fetch>();

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();

    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers logout token to BCL-registered client", async () => {
    await createBclClient(BCL_CLIENT_ID, { backchannelLogoutUri: BCL_URI });

    await sendLogout();

    expect(fetchSpy).toHaveBeenCalledWith(
      BCL_URI,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("logout token has correct JWT structure", async () => {
    await createBclClient(BCL_CLIENT_ID, { backchannelLogoutUri: BCL_URI });

    await sendLogout();

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
      backchannelLogoutUri: BCL_URI,
      backchannelLogoutSessionRequired: true,
    });

    const sessionId = crypto.randomUUID();
    await sendLogout(sessionId);

    const body = fetchSpy.mock.calls[0]?.[1]?.body as string;
    const params = new URLSearchParams(body);
    const payload = decodeJwt(params.get("logout_token") as string);
    expect(payload.sid).toBe(sessionId);
  });

  it("omits sid when session_required is false", async () => {
    await createBclClient(BCL_CLIENT_ID, { backchannelLogoutUri: BCL_URI });

    await sendLogout("session-123");

    const body = fetchSpy.mock.calls[0]?.[1]?.body as string;
    const params = new URLSearchParams(body);
    const payload = decodeJwt(params.get("logout_token") as string);
    expect(payload.sid).toBeUndefined();
  });

  it("skips clients without backchannel_logout_uri", async () => {
    await createBclClient(BCL_CLIENT_ID);

    await sendLogout();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("jti is unique across multiple logout events", async () => {
    await createBclClient(BCL_CLIENT_ID, { backchannelLogoutUri: BCL_URI });

    await sendLogout();
    await sendLogout();

    const getJti = (callIndex: number) => {
      const body = fetchSpy.mock.calls[callIndex]?.[1]?.body as string;
      const params = new URLSearchParams(body);
      return decodeJwt(params.get("logout_token") as string).jti;
    };

    expect(getJti(0)).not.toBe(getJti(1));
  });

  it("revokePendingCibaOnLogout rejects pending CIBA requests", async () => {
    const authReqId = crypto.randomUUID();
    await createBclClient(BCL_CLIENT_ID);
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
    await createBclClient(BCL_CLIENT_ID);
    const { authReqId: approvedId } = await createTestCibaRequest({
      clientId: BCL_CLIENT_ID,
      userId,
      status: "approved",
    });

    const { revokePendingCibaOnLogout } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await revokePendingCibaOnLogout(userId);

    const row = await db
      .select({ status: cibaRequests.status })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(approvedId)))
      .get();
    expect(row?.status).toBe("approved");
  });
});
