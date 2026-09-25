import { describe, expect, it, vi } from "vitest";

// Ensure drizzle-orm sql tag is available even if a prior vmThread file
// replaced the module cache with an incomplete mock.
vi.mock("drizzle-orm", async (importOriginal) => importOriginal());

describe("backchannel-logout module", () => {
  it("sendBackchannelLogoutToClient skips clients without a logout URI", async () => {
    const { sendBackchannelLogoutToClient } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await expect(
      sendBackchannelLogoutToClient({
        clientId: "nonexistent-client",
        userId: "nonexistent-user",
      })
    ).resolves.toBeUndefined();
  });

  it("revokePendingCibaOnLogout handles no pending requests gracefully", async () => {
    const { revokePendingCibaOnLogout } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await expect(
      revokePendingCibaOnLogout("nonexistent-user")
    ).resolves.not.toThrow();
  });
});
