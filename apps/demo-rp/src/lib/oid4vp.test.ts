import { createClient } from "@libsql/client";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { eq } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { vpSessions } from "@/lib/db/schema";
import { VERIFIER_SCENARIOS } from "@/scenarios/veripass/verifier-registry";

const database = vi.hoisted(() => ({
  current: null as LibSQLDatabase | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/connection", () => ({ getDb: () => database.current }));
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://rp.example",
    VERIFIER_CERT_PATH: "/certs",
  },
}));
vi.mock("@/lib/x509", () => ({
  getVerifierClientId: () => "x509_hash:leaf-thumbprint",
  loadCertChain: () => ["leaf-der", "ca-der"],
  loadLeafKeyPem: () => "leaf-key-pem",
  loadLeafPem: () => "leaf-pem",
}));
vi.mock("@/lib/jar", () => ({
  signAuthorizationRequest: async (params: Record<string, unknown>) =>
    `signed-request.${String(params.state)}`,
}));

const scenarioId = VERIFIER_SCENARIOS[0]?.id ?? "";

async function createSession() {
  const { createVpSession } = await import("./oid4vp");
  const { authorizationUri, sessionId } = await createVpSession(
    scenarioId,
    null
  );
  const row = await database.current
    ?.select()
    .from(vpSessions)
    .where(eq(vpSessions.id, sessionId))
    .get();
  return {
    authorizationUri,
    row,
    sessionId,
    signedRequest: `signed-request.${row?.state}`,
  };
}

describe("VP session request objects", () => {
  beforeEach(async () => {
    vi.resetModules();
    const client = createClient({ url: ":memory:" });
    const statements = await generateSQLiteMigration(
      await generateSQLiteDrizzleJson({}),
      await generateSQLiteDrizzleJson({ vpSessions })
    );
    await client.batch(statements);
    database.current = drizzle(client);
  });

  it("records the client_id the request advertises", async () => {
    const { authorizationUri, row } = await createSession();

    expect(row?.clientId).toBe("x509_hash:leaf-thumbprint");
    expect(new URL(authorizationUri).searchParams.get("client_id")).toBe(
      row?.clientId
    );
  });

  it("serves the request object from a server instance that did not sign it", async () => {
    const { sessionId, signedRequest } = await createSession();

    vi.resetModules();
    const { consumeSignedRequest } = await import("./oid4vp");

    await expect(consumeSignedRequest(sessionId)).resolves.toBe(signedRequest);
  });

  it("serves the request object once", async () => {
    const { sessionId, signedRequest } = await createSession();
    const { consumeSignedRequest } = await import("./oid4vp");

    await expect(consumeSignedRequest(sessionId)).resolves.toBe(signedRequest);
    await expect(consumeSignedRequest(sessionId)).resolves.toBeNull();
  });

  it("does not serve the request object after the session expires", async () => {
    const { sessionId } = await createSession();
    await database.current
      ?.update(vpSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(vpSessions.id, sessionId));
    const { consumeSignedRequest } = await import("./oid4vp");

    await expect(consumeSignedRequest(sessionId)).resolves.toBeNull();
  });
});
