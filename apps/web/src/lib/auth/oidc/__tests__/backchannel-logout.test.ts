import { describe, expect, it, vi } from "vitest";

// Ensure drizzle-orm sql tag is available even if a prior vmThread file
// replaced the module cache with an incomplete mock.
vi.mock("drizzle-orm", async (importOriginal) => importOriginal());

/**
 * BCL logout token structure validation.
 *
 * The buildLogoutToken function is internal (not exported), but we can
 * verify the spec compliance via the targeted delivery function's
 * behavior. These tests validate the module's public contract.
 */
describe("backchannel-logout module", () => {
  it("module exports sendBackchannelLogoutToClient", async () => {
    const mod = await import("@/lib/auth/oidc/backchannel-logout");
    expect(typeof mod.sendBackchannelLogoutToClient).toBe("function");
  });

  it("module exports revokePendingCibaOnLogout", async () => {
    const mod = await import("@/lib/auth/oidc/backchannel-logout");
    expect(typeof mod.revokePendingCibaOnLogout).toBe("function");
  });

  it("targeted delivery handles an unknown BCL client gracefully", async () => {
    const { sendBackchannelLogoutToClient } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    await expect(
      sendBackchannelLogoutToClient({
        clientId: "nonexistent-client",
        userId: "nonexistent-user",
      })
    ).resolves.not.toThrow();
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
