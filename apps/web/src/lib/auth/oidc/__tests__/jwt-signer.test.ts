import type { JWK } from "jose";

import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, importJWK, jwtVerify } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { computePairwiseSub } from "@/lib/auth/oidc/pairwise";
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

  describe("access token subjects", () => {
    const decodePayload = (token: string) =>
      JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf-8")
      ) as Record<string, unknown>;

    async function withClient(
      subjectType: "pairwise" | "public",
      run: (clientId: string) => Promise<void>
    ) {
      const clientId = `subject-${crypto.randomUUID()}`;
      await db
        .insert(oauthClients)
        .values({
          clientId,
          redirectUris: '["http://localhost:4100/callback"]',
          subjectType,
        })
        .run();
      try {
        await run(clientId);
      } finally {
        await db
          .delete(oauthClients)
          .where(eq(oauthClients.clientId, clientId))
          .run();
      }
    }

    it("carries a pairwise client's pairwise subject", async () => {
      await withClient("pairwise", async (clientId) => {
        const token = await signJwt({
          scope: "openid",
          azp: clientId,
          sub: "user-1",
        });
        const expected = await computePairwiseSub(
          "user-1",
          ["http://localhost:4100/callback"],
          env.PAIRWISE_SECRET
        );
        expect(decodePayload(token).sub).toBe(expected);
      });
    });

    it("carries the user id for a public client", async () => {
      await withClient("public", async (clientId) => {
        const token = await signJwt({
          scope: "openid",
          azp: clientId,
          sub: "user-1",
        });
        expect(decodePayload(token).sub).toBe("user-1");
      });
    });

    it("keeps the client as the subject of client-credentials tokens", async () => {
      await withClient("pairwise", async (clientId) => {
        const token = await signJwt({
          scope: "rp:api",
          azp: clientId,
          sub: clientId,
        });
        expect(decodePayload(token).sub).toBe(clientId);
      });
    });

    it("refuses to sign for an unknown client", async () => {
      await expect(
        signJwt({ scope: "openid", azp: "unknown-client", sub: "user-1" })
      ).rejects.toThrow("Unknown client");
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

    it("signs RS256 even when the client requests another id_token alg", async () => {
      const testClientId = `alg-pref-${crypto.randomUUID()}`;
      await db
        .insert(oauthClients)
        .values({
          clientId: testClientId,
          redirectUris: '["http://localhost/callback"]',
          metadata: '{"id_token_signed_response_alg":"ES256"}',
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
        expect(header.alg).toBe("RS256");
        expect(header.kid).toBe(rsaKid);
      } finally {
        await db
          .delete(oauthClients)
          .where(eq(oauthClients.clientId, testClientId))
          .run();
      }
    });
  });
});
