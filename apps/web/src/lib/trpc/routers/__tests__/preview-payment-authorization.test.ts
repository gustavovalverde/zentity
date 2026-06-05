/**
 * Locks the wire surface of `agent.previewPaymentAuthorization` (Phase 3d).
 *
 * The dashboard and the push card service worker render against the
 * projection this procedure returns; the issuer signs the projection
 * before any user-visible card is shown (Proposal-0003 D-7). A change to
 * either side without the other is the wire break this test catches.
 */

import type { Session } from "@/lib/auth/auth-config";

import { describe, expect, it } from "vitest";

const RAR_TOO_MANY_ENTRIES = /rar_too_many_entries/;

async function createCaller(userId: string | null) {
  const { agentRouter } = await import("@/lib/trpc/routers/agent");
  const session = userId
    ? ({
        session: { id: `session:${userId}` },
        user: { id: userId },
      } as unknown as Session)
    : null;

  return agentRouter.createCaller({
    flowId: null,
    flowIdSource: "none",
    req: new Request("http://localhost/api/trpc"),
    requestId: "test-request-id",
    resHeaders: new Headers(),
    session,
  });
}

const VALID_ENTRY = {
  type: "payment_authorization",
  chain: { namespace: "zcash", reference: "test" },
  recipient: "zcash:test:utest1qq0",
  amount: { currency: "ZEC", value: "50000000", unit: "base" as const },
  payment_id: "01KT9A0V431VGD5YH7R7G635HC",
  intent_hash: "v1:sha256:tH5IGJbnV6NxSl9nmwbFc8EWDF6rfYcXgOfHFmmIjUQ",
  expires_at: { kind: "block_height" as const, value: 4_047_100 },
};

describe("agent.previewPaymentAuthorization", () => {
  it("returns a render-ready projection for a well-formed RAR", async () => {
    const caller = await createCaller("user-1");
    const preview = await caller.previewPaymentAuthorization({
      authorizationDetails: [VALID_ENTRY],
      bindingMessage: "Confirm code: AB12CD",
    });

    expect(preview.chain).toBe("zcash:test");
    expect(preview.recipient).toBe(VALID_ENTRY.recipient);
    expect(preview.amount).toEqual(VALID_ENTRY.amount);
    expect(preview.amountDisplay).toContain("50000000 ZEC");
    expect(preview.paymentId).toBe(VALID_ENTRY.payment_id);
    expect(preview.intentHash).toBe(VALID_ENTRY.intent_hash);
    expect(preview.expiresAt).toEqual(VALID_ENTRY.expires_at);
    expect(preview.bindingMessage).toBe("Confirm code: AB12CD");
  });

  it("returns null bindingMessage when none was provided", async () => {
    const caller = await createCaller("user-1");
    const preview = await caller.previewPaymentAuthorization({
      authorizationDetails: [VALID_ENTRY],
    });
    expect(preview.bindingMessage).toBeNull();
  });

  it("formats display unit amounts without the (base unit) suffix", async () => {
    const caller = await createCaller("user-1");
    const preview = await caller.previewPaymentAuthorization({
      authorizationDetails: [
        {
          ...VALID_ENTRY,
          amount: { currency: "ZEC", value: "0.5", unit: "display" },
        },
      ],
    });
    expect(preview.amountDisplay).toBe("0.5 ZEC");
  });

  it("rejects an authorization_details array with more than one entry (rar_too_many_entries)", async () => {
    const caller = await createCaller("user-1");
    await expect(
      caller.previewPaymentAuthorization({
        authorizationDetails: [VALID_ENTRY, VALID_ENTRY],
      })
    ).rejects.toThrow(RAR_TOO_MANY_ENTRIES);
  });

  it("rejects an empty authorization_details array", async () => {
    const caller = await createCaller("user-1");
    await expect(
      caller.previewPaymentAuthorization({
        authorizationDetails: [],
      })
    ).rejects.toThrow();
  });

  it("requires an authenticated session", async () => {
    const caller = await createCaller(null);
    await expect(
      caller.previewPaymentAuthorization({
        authorizationDetails: [VALID_ENTRY],
      })
    ).rejects.toThrow();
  });
});
