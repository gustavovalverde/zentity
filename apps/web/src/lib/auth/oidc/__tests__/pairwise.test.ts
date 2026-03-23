import { makeSignature } from "better-auth/crypto";
import { describe, expect, it } from "vitest";

import {
  computePairwiseSub,
  resolveSubForClient,
} from "@/lib/auth/oidc/pairwise";

const TEST_SECRET = "test-secret-at-least-32-characters-long";

describe("computePairwiseSub", () => {
  it("is deterministic — same inputs produce same output", async () => {
    const a = await computePairwiseSub(
      "user-1",
      ["https://example.com/cb"],
      TEST_SECRET
    );
    const b = await computePairwiseSub(
      "user-1",
      ["https://example.com/cb"],
      TEST_SECRET
    );
    expect(a).toBe(b);
  });

  it("produces different output for different users", async () => {
    const a = await computePairwiseSub(
      "user-1",
      ["https://example.com/cb"],
      TEST_SECRET
    );
    const b = await computePairwiseSub(
      "user-2",
      ["https://example.com/cb"],
      TEST_SECRET
    );
    expect(a).not.toBe(b);
  });

  it("produces different output for different sectors", async () => {
    const a = await computePairwiseSub(
      "user-1",
      ["https://alpha.com/cb"],
      TEST_SECRET
    );
    const b = await computePairwiseSub(
      "user-1",
      ["https://beta.com/cb"],
      TEST_SECRET
    );
    expect(a).not.toBe(b);
  });

  it("matches better-auth's derivation (golden test)", async () => {
    const userId = "user-golden";
    const redirectUris = ["https://rp.example.com/callback"];
    const sector = "rp.example.com";

    const ours = await computePairwiseSub(userId, redirectUris, TEST_SECRET);
    const theirs = await makeSignature(`${sector}.${userId}`, TEST_SECRET);
    expect(ours).toBe(theirs);
  });

  it("produces consistent results for same input", async () => {
    const a = await computePairwiseSub(
      "user-1",
      ["https://example.com/cb"],
      TEST_SECRET
    );
    const b = await computePairwiseSub(
      "user-1",
      ["https://example.com/cb"],
      TEST_SECRET
    );
    expect(a).toBe(b);
  });
});

describe("resolveSubForClient", () => {
  it("returns raw userId for non-pairwise clients", async () => {
    const result = await resolveSubForClient("user-1", {
      subjectType: null,
      redirectUris: ["https://example.com/cb"],
    });
    expect(result).toBe("user-1");
  });

  it("returns raw userId for public clients", async () => {
    const result = await resolveSubForClient("user-1", {
      subjectType: "public",
      redirectUris: ["https://example.com/cb"],
    });
    expect(result).toBe("user-1");
  });

  it("returns pairwise sub for pairwise clients", async () => {
    const result = await resolveSubForClient("user-1", {
      subjectType: "pairwise",
      redirectUris: ["https://example.com/cb"],
    });
    expect(result).not.toBe("user-1");
    // Should match the direct computation
    const expected = await computePairwiseSub(
      "user-1",
      ["https://example.com/cb"],
      // Uses env.PAIRWISE_SECRET internally
      process.env.PAIRWISE_SECRET ?? ""
    );
    expect(result).toBe(expected);
  });
});
