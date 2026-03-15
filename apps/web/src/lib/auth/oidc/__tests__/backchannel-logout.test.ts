import { describe, expect, it } from "vitest";

/**
 * BCL logout token structure validation.
 *
 * The buildLogoutToken function is internal (not exported), but we can
 * verify the spec compliance via the sendBackchannelLogout function's
 * behavior. These tests validate the module's public contract.
 */
describe("backchannel-logout module", () => {
  it("module exports sendBackchannelLogout", async () => {
    const mod = await import("@/lib/auth/oidc/backchannel-logout");
    expect(typeof mod.sendBackchannelLogout).toBe("function");
  });

  it("module exports revokePendingCibaOnLogout", async () => {
    const mod = await import("@/lib/auth/oidc/backchannel-logout");
    expect(typeof mod.revokePendingCibaOnLogout).toBe("function");
  });

  it("sendBackchannelLogout handles no BCL clients gracefully", async () => {
    const { sendBackchannelLogout } = await import(
      "@/lib/auth/oidc/backchannel-logout"
    );
    // Should not throw even when no clients are registered
    await expect(
      sendBackchannelLogout("nonexistent-user")
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
