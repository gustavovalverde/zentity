import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/jwks";
import { resetDatabase } from "@/test/db-test-utils";

import { getJwtSigningKeys } from "../jwt-signing-keys";

describe("getJwtSigningKeys", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("filters ML-DSA and encryption keys out of the Better Auth adapter view", async () => {
    await db
      .insert(jwks)
      .values([
        {
          id: "rs256-key",
          publicKey: JSON.stringify({ kty: "RSA", e: "AQAB", n: "rsa-n" }),
          privateKey: JSON.stringify({
            kty: "RSA",
            d: "rsa-d",
            e: "AQAB",
            n: "rsa-n",
          }),
          alg: "RS256",
          createdAt: new Date("2026-03-23T15:00:00.000Z"),
        },
        {
          id: "eddsa-key",
          publicKey: JSON.stringify({
            kty: "OKP",
            crv: "Ed25519",
            x: "eddsa-x",
          }),
          privateKey: JSON.stringify({
            kty: "OKP",
            crv: "Ed25519",
            d: "eddsa-d",
            x: "eddsa-x",
          }),
          alg: "EdDSA",
          crv: "Ed25519",
          createdAt: new Date("2026-03-23T15:01:00.000Z"),
        },
        {
          id: "ml-dsa-key",
          publicKey: JSON.stringify({
            kty: "AKP",
            alg: "ML-DSA-65",
            pub: "ml-dsa-pub",
          }),
          privateKey: JSON.stringify({ raw: "ml-dsa-secret" }),
          alg: "ML-DSA-65",
          createdAt: new Date("2026-03-23T15:02:00.000Z"),
        },
        {
          id: "jarm-key",
          publicKey: JSON.stringify({
            kty: "EC",
            crv: "P-256",
            x: "ec-x",
            y: "ec-y",
          }),
          privateKey: JSON.stringify({
            kty: "EC",
            crv: "P-256",
            d: "ec-d",
            x: "ec-x",
            y: "ec-y",
          }),
          alg: "ECDH-ES",
          crv: "P-256",
          createdAt: new Date("2026-03-23T15:03:00.000Z"),
        },
      ])
      .run();

    const keys = await getJwtSigningKeys();

    expect(keys.map((key) => key.id).sort()).toEqual([
      "eddsa-key",
      "rs256-key",
    ]);
    expect(keys.map((key) => key.alg).sort()).toEqual(["EdDSA", "RS256"]);
    expect(keys.find((key) => key.id === "eddsa-key")?.crv).toBe("Ed25519");
  });
});
