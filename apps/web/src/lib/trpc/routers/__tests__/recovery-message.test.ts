import { describe, expect, it } from "vitest";

import { buildRecoveryMessage } from "@/lib/trpc/routers/recovery";

describe("recovery signing intent format", () => {
  it("builds a canonical v1 recovery intent message", () => {
    const challengeId = "11111111-1111-4111-8111-111111111111";
    const challengeNonce = "22222222-2222-4222-8222-222222222222";

    const message = buildRecoveryMessage({ challengeId, challengeNonce });
    expect(message).toBe(
      "zentity-recovery-intent:v1:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222"
    );
  });

  it("includes prefix, version, and both UUIDs as colon-separated fields", () => {
    const message = buildRecoveryMessage({
      challengeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      challengeNonce: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    const parts = message.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("zentity-recovery-intent");
    expect(parts[1]).toBe("v1");
    expect(parts[2]).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(parts[3]).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });
});
