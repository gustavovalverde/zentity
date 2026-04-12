import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { getSignerPin, pinSignerIdentity } from "@/lib/db/queries/recovery";
import { resetDatabase } from "@/test-utils/db-test-utils";

describe("recovery signer pin queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reuses an existing signer pin when the identity matches", async () => {
    const endpoint = "http://signer-1.local";
    const identityPubkey = "identity-a";

    await pinSignerIdentity({
      id: crypto.randomUUID(),
      signerEndpoint: endpoint,
      identityPubkey,
    });

    const reused = await pinSignerIdentity({
      id: crypto.randomUUID(),
      signerEndpoint: endpoint,
      identityPubkey,
    });

    expect(reused.identityPubkey).toBe(identityPubkey);
    expect(reused.signerEndpoint).toBe(endpoint);
  });

  it("rejects a conflicting pin for the same signer endpoint", async () => {
    const endpoint = "http://signer-1.local";

    await pinSignerIdentity({
      id: crypto.randomUUID(),
      signerEndpoint: endpoint,
      identityPubkey: "identity-a",
    });

    await expect(
      pinSignerIdentity({
        id: crypto.randomUUID(),
        signerEndpoint: endpoint,
        identityPubkey: "identity-b",
      })
    ).rejects.toThrow(`Signer identity pin mismatch for ${endpoint}.`);

    const persisted = await getSignerPin(endpoint);
    expect(persisted?.identityPubkey).toBe("identity-a");
  });
});
