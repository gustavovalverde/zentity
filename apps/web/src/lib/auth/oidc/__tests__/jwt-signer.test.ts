import type { JWK } from "jose";

import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, importJWK, jwtVerify } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/connection";
import { jwks, oauthClients } from "@/lib/db/schema/oauth-provider";

let signJwt: typeof import("../jwt-signer").signJwt;

describe("jwt-signer multi-algorithm dispatcher", () => {
  let edDsaKid: string;
  let edDsaPublicJwk: JWK;
  let rsaKid: string;
  let rsaPublicJwk: JWK;

  beforeAll(async () => {
    // Clear keys from other test files sharing this DB
    await db.delete(jwks).run();

    // Seed EdDSA key (used for access tokens)
    const edDsa = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    edDsaPublicJwk = await exportJWK(edDsa.publicKey);
    edDsaKid = crypto.randomUUID();

    await db
      .insert(jwks)
      .values({
        id: edDsaKid,
        publicKey: JSON.stringify(edDsaPublicJwk),
        privateKey: JSON.stringify(await exportJWK(edDsa.privateKey)),
        alg: "EdDSA",
        crv: "Ed25519",
      })
      .run();

    // Seed RS256 key (default for id_tokens)
    const rsa = await generateKeyPair("RS256", {
      modulusLength: 2048,
      extractable: true,
    });
    rsaPublicJwk = await exportJWK(rsa.publicKey);
    rsaKid = crypto.randomUUID();

    await db
      .insert(jwks)
      .values({
        id: rsaKid,
        publicKey: JSON.stringify(rsaPublicJwk),
        privateKey: JSON.stringify(await exportJWK(rsa.privateKey)),
        alg: "RS256",
        crv: null,
      })
      .run();

    // Dynamic import to reset module-level cache
    const mod = await import("../jwt-signer");
    signJwt = mod.signJwt;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("access tokens (payload with scope)", () => {
    it("signs with EdDSA", async () => {
      const token = await signJwt({
        scope: "openid email",
        azp: "some-client",
        sub: "user-1",
      });

      const parts = token.split(".");
      expect(parts).toHaveLength(3);

      const header = JSON.parse(
        Buffer.from(parts[0] ?? "", "base64url").toString("utf-8")
      );
      expect(header.alg).toBe("EdDSA");
      expect(header.typ).toBe("JWT");
      expect(header.kid).toBe(edDsaKid);
    });

    it("produces tokens verifiable by jose", async () => {
      const token = await signJwt({
        scope: "openid",
        sub: "user-1",
        iss: "https://zentity.test",
      });

      const key = await importJWK(edDsaPublicJwk, "EdDSA");
      const { payload } = await jwtVerify(token, key);
      expect(payload.sub).toBe("user-1");
      expect(payload.scope).toBe("openid");
    });
  });

  describe("id tokens (no scope)", () => {
    it("signs with RS256 by default", async () => {
      const token = await signJwt({
        aud: "some-client-id",
        sub: "user-1",
        iss: "https://zentity.test",
      });

      const header = JSON.parse(
        Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf-8")
      );
      expect(header.alg).toBe("RS256");
      expect(header.kid).toBe(rsaKid);
    });

    it("RS256 id_token is verifiable by jose", async () => {
      const token = await signJwt({
        aud: "rs256-verify-test",
        sub: "user-1",
        iss: "https://zentity.test",
      });

      const key = await importJWK(rsaPublicJwk, "RS256");
      const { payload } = await jwtVerify(token, key);
      expect(payload.sub).toBe("user-1");
      expect(payload.iss).toBe("https://zentity.test");
    });

    it("signs with EdDSA when client opts in", async () => {
      const testClientId = `eddsa-optin-${crypto.randomUUID()}`;
      await db
        .insert(oauthClients)
        .values({
          clientId: testClientId,
          redirectUris: '["http://localhost/callback"]',
          metadata: '{"id_token_signed_response_alg":"EdDSA"}',
        })
        .run();

      try {
        const token = await signJwt({
          aud: testClientId,
          sub: "user-1",
        });

        const header = JSON.parse(
          Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf-8")
        );
        expect(header.alg).toBe("EdDSA");
        expect(header.kid).toBe(edDsaKid);
      } finally {
        await db
          .delete(oauthClients)
          .where(eq(oauthClients.clientId, testClientId))
          .run();
      }
    });

    it("signs with ML-DSA-65 when client opts in", async () => {
      const testClientId = `ml-dsa-test-${crypto.randomUUID()}`;
      await db
        .insert(oauthClients)
        .values({
          clientId: testClientId,
          redirectUris: '["http://localhost/callback"]',
          metadata: '{"id_token_signed_response_alg":"ML-DSA-65"}',
        })
        .run();

      try {
        const token = await signJwt({
          aud: testClientId,
          sub: "user-1",
        });

        const header = JSON.parse(
          Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf-8")
        );
        expect(header.alg).toBe("ML-DSA-65");
      } finally {
        await db
          .delete(oauthClients)
          .where(eq(oauthClients.clientId, testClientId))
          .run();
      }
    });
  });

  describe("resolveClientId extraction", () => {
    it("extracts from string aud", async () => {
      const token = await signJwt({
        aud: "client-from-aud",
        sub: "user-1",
      });

      expect(token.split(".")).toHaveLength(3);
    });

    it("extracts from array aud", async () => {
      const token = await signJwt({
        aud: ["client-array-0", "client-array-1"],
        sub: "user-1",
      });

      expect(token.split(".")).toHaveLength(3);
    });

    it("falls back to azp", async () => {
      const token = await signJwt({
        azp: "client-from-azp",
        sub: "user-1",
      });

      expect(token.split(".")).toHaveLength(3);
    });

    it("defaults to RS256 when no clientId is resolvable", async () => {
      const token = await signJwt({
        sub: "user-1",
      });

      const header = JSON.parse(
        Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf-8")
      );
      expect(header.alg).toBe("RS256");
    });
  });

  describe("client preference cache", () => {
    it("uses cached alg on second call", async () => {
      const testClientId = `cache-test-${crypto.randomUUID()}`;
      await db
        .insert(oauthClients)
        .values({
          clientId: testClientId,
          redirectUris: '["http://localhost/callback"]',
          metadata: '{"id_token_signed_response_alg":"EdDSA"}',
        })
        .run();

      try {
        // First call populates cache
        await signJwt({ aud: testClientId, sub: "user-1" });
        // Second call hits cache
        const token = await signJwt({ aud: testClientId, sub: "user-2" });

        const header = JSON.parse(
          Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf-8")
        );
        expect(header.alg).toBe("EdDSA");
      } finally {
        await db
          .delete(oauthClients)
          .where(eq(oauthClients.clientId, testClientId))
          .run();
      }
    });
  });
});
