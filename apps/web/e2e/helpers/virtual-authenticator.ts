import type { Page } from "@playwright/test";

/**
 * Attach a CTAP2 platform authenticator with PRF support to the page, so
 * passkey registration and PRF evaluation run without user interaction.
 */
export async function addPrfAuthenticator(
  page: Page
): Promise<{ remove: () => Promise<void> }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        ctap2Version: "ctap2_1",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
        hasPrf: true,
      },
    }
  );

  return {
    remove: async () => {
      await cdp.send("WebAuthn.removeVirtualAuthenticator", {
        authenticatorId,
      });
    },
  };
}
