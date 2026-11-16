import { makeSignature } from "better-auth/crypto";
import { describe, expect, it } from "vitest";

import {
  clientSector,
  computePairwiseSub,
  resolveSubForClient,
} from "@/lib/auth/oidc/pairwise";

const TEST_SECRET = "test-secret-at-least-32-characters-long";

describe("clientSector", () => {
  it("uses the stored sector over the redirect hosts", () => {
    expect(
      clientSector({
        sectorIdentifier: "client/agent-1",
        redirectUris: ["http://127.0.0.1:8765/callback"],
      })
    ).toBe("client/agent-1");
  });

  it("falls back to the first redirect host for a row without a sector", () => {
    expect(
      clientSector({
        sectorIdentifier: null,
        redirectUris: ["https://rp.example.com/cb", "https://other.example/cb"],
      })
    ).toBe("rp.example.com");
  });

  it("refuses a row with neither a sector nor a redirect URI", () => {
    expect(() =>
      clientSector({ sectorIdentifier: null, redirectUris: [] })
    ).toThrow("Client has no redirect URIs for sector identifier");
  });
});

describe("computePairwiseSub", () => {
  it("is deterministic for the same subject and sector", async () => {
    const a = await computePairwiseSub("user-1", "example.com", TEST_SECRET);
    const b = await computePairwiseSub("user-1", "example.com", TEST_SECRET);
    expect(a).toBe(b);
  });

  it("produces different output for different users", async () => {
    const a = await computePairwiseSub("user-1", "example.com", TEST_SECRET);
    const b = await computePairwiseSub("user-2", "example.com", TEST_SECRET);
    expect(a).not.toBe(b);
  });

  it("produces different output for different sectors", async () => {
    const a = await computePairwiseSub("user-1", "alpha.com", TEST_SECRET);
    const b = await computePairwiseSub("user-1", "beta.com", TEST_SECRET);
    expect(a).not.toBe(b);
  });

  it("matches better-auth's derivation (golden test)", async () => {
    const ours = await computePairwiseSub(
      "user-golden",
      "rp.example.com",
      TEST_SECRET
    );
    const theirs = await makeSignature(
      "rp.example.com.user-golden",
      TEST_SECRET
    );
    expect(ours).toBe(theirs);
  });
});

describe("resolveSubForClient", () => {
  const redirectUris = ["https://example.com/cb"];

  it("returns raw userId for non-pairwise clients", async () => {
    const result = await resolveSubForClient("user-1", {
      subjectType: null,
      sectorIdentifier: null,
      redirectUris,
    });
    expect(result).toBe("user-1");
  });

  it("returns raw userId for public clients", async () => {
    const result = await resolveSubForClient("user-1", {
      subjectType: "public",
      sectorIdentifier: null,
      redirectUris,
    });
    expect(result).toBe("user-1");
  });

  it("returns the pairwise sub of the stored sector", async () => {
    const result = await resolveSubForClient("user-1", {
      subjectType: "pairwise",
      sectorIdentifier: "client/agent-1",
      redirectUris,
    });
    expect(result).toBe(
      await computePairwiseSub(
        "user-1",
        "client/agent-1",
        process.env.PAIRWISE_SECRET ?? ""
      )
    );
  });
});
