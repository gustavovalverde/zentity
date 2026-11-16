import { expect, type Page } from "@playwright/test";

const ADD_PASSKEY = /^add passkey$/i;
const USE_PASSWORD = /^use your password$/i;
const PASSWORD_LABEL = /^Password$/i;
const UNLOCK = /^unlock$/i;

export interface PrfAuthenticator {
  remove: () => Promise<void>;
  /** Whether the authenticator reports user verification from now on. */
  setUserVerified: (isUserVerified: boolean) => Promise<void>;
  /** Assertions signed so far, summed over the authenticator's passkeys. */
  signCount: () => Promise<number>;
}

/**
 * Attach a CTAP2 platform authenticator with PRF support to the page, so
 * passkey registration and PRF evaluation run without user interaction.
 * Without `userVerification`, it signs every assertion without verifying the
 * user, like a security key that has no PIN.
 */
export async function addPrfAuthenticator(
  page: Page,
  { userVerification = true }: { userVerification?: boolean } = {}
): Promise<PrfAuthenticator> {
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
        hasUserVerification: userVerification,
        isUserVerified: userVerification,
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
    setUserVerified: async (isUserVerified) => {
      await cdp.send("WebAuthn.setUserVerified", {
        authenticatorId,
        isUserVerified,
      });
    },
    signCount: async () => {
      const { credentials } = await cdp.send("WebAuthn.getCredentials", {
        authenticatorId,
      });
      return credentials.reduce(
        (total, credential) => total + credential.signCount,
        0
      );
    },
  };
}

/**
 * Registers a passkey for the signed-in password user through the passkey
 * settings, which also wraps the user's vault for it. Attach the
 * authenticator first.
 */
export async function registerPasskeyForUser(
  page: Page,
  password: string
): Promise<void> {
  await page.goto("/dashboard/settings");
  await page.getByRole("button", { name: ADD_PASSKEY }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: USE_PASSWORD }).click();
  await dialog.getByLabel(PASSWORD_LABEL).fill(password);
  await dialog.getByRole("button", { name: UNLOCK }).click();
  await expect(page.getByText("Passkey 1")).toBeVisible({ timeout: 30_000 });
}
