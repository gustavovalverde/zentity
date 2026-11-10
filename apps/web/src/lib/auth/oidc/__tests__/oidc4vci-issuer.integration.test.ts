import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { GET as serveJwks } from "@/app/api/auth/oauth2/jwks/route";
import { auth } from "@/lib/auth/auth-config";
import { resetDatabase } from "@/test-utils/db-test-utils";

const AUTH_URL = "http://localhost:3000/api/auth";

describe("OID4VCI issuer wire format", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns a c_nonce for the empty POST wallets send", async () => {
    // OID4VCI 1.0 §7.1: no body and no Content-Type, but over HTTP the
    // request still carries an (empty) body stream.
    const response = await auth.handler(
      new Request(`${AUTH_URL}/oidc4vci/nonce`, {
        method: "POST",
        body: new Uint8Array(),
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { c_nonce?: unknown };
    expect(body.c_nonce).toBeTypeOf("string");
  });

  it("signs the token status list as statuslist+jwt", async () => {
    const response = await auth.handler(
      new Request(`${AUTH_URL}/oidc4vci/status-list`)
    );
    expect(response.status).toBe(200);
    const statusList = await response.text();

    const jwks = (await (await serveJwks()).json()) as JSONWebKeySet;
    const { protectedHeader } = await jwtVerify(
      statusList,
      createLocalJWKSet(jwks),
      { typ: "statuslist+jwt" }
    );
    expect(protectedHeader.typ).toBe("statuslist+jwt");
  });
});
