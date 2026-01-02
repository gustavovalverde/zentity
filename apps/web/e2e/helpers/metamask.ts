import type { Page } from "@playwright/test";
import type { MetaMask } from "@synthetixio/synpress/playwright";

const SIGN_BUTTON_SELECTORS = [
  "button[data-testid='signature-sign-button']",
  "button[data-testid='page-container-footer-next']",
  "button[data-testid='request-signature__sign']",
].join(", ");

const RISK_SIGN_BUTTON_SELECTOR =
  "button[data-testid='signature-warning-sign-button']";

const SCROLL_BUTTON_SELECTOR =
  "[data-testid='signature-request-scroll-button']";

const SIGNATURE_MESSAGE_SELECTOR = ".signature-request-message";
const PROCEED_ANYWAY_SELECTOR = "text=/I want to proceed anyway/i";
const GAS_WARNING_SELECTOR =
  "text=/We were not able to estimate gas/i, text=/transaction may fail/i";
const CONFIRM_BUTTON_SELECTOR =
  "button[data-testid='page-container-footer-next'], button:has-text('Confirm')";

async function clickProceedAnyway(notificationPage: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (notificationPage.isClosed()) {
      return;
    }
    const proceedLinks = notificationPage.locator(PROCEED_ANYWAY_SELECTOR);
    const count = await proceedLinks.count();
    if (count === 0) {
      return;
    }

    for (let i = 0; i < count; i += 1) {
      const link = proceedLinks.nth(i);
      if (notificationPage.isClosed()) {
        return;
      }
      await link.scrollIntoViewIfNeeded().catch(() => {
        /* Scroll may fail if element is not attached */
      });
      await link.click({ force: true }).catch(() => {
        /* Click may fail if element is detached or page closed */
      });
      if (notificationPage.isClosed()) {
        return;
      }
      await notificationPage.waitForTimeout(200);
    }
  }
}

async function findNotificationPage(
  metamask: MetaMask,
  timeoutMs = 30_000
): Promise<Page> {
  if (!metamask.extensionId) {
    throw new Error("MetaMask extensionId is missing for notifications");
  }

  const extensionBase = `chrome-extension://${metamask.extensionId}`;
  const isPopup = (page: Page) => {
    const url = page.url();
    if (!url.startsWith(extensionBase)) {
      return false;
    }
    if (url.includes("home.html") || url.includes("onboarding.html")) {
      return false;
    }
    return true;
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidate = metamask.context.pages().find(isPopup);
    if (candidate) {
      await candidate.waitForLoadState("domcontentloaded");
      return candidate;
    }
    try {
      const popup = await metamask.context.waitForEvent("page", {
        predicate: isPopup,
        timeout: Math.min(2000, Math.max(250, deadline - Date.now())),
      });
      await popup.waitForLoadState("domcontentloaded");
      return popup;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error("MetaMask notification window not found");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await new Promise<T>((resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("MetaMask action timed out")),
        timeoutMs
      );
      promise.then(resolve, reject);
    });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function confirmSignature(metamask: MetaMask): Promise<void> {
  try {
    await withTimeout(metamask.confirmSignature(), 10_000);
    return;
  } catch {
    // Fall back to the "risk" flow if MetaMask shows a warning modal.
    try {
      await withTimeout(metamask.confirmSignatureWithRisk(), 10_000);
      return;
    } catch {
      // Continue to manual fallback below.
    }
  }

  const notificationPage = await findNotificationPage(metamask);
  await notificationPage.bringToFront();

  const signButton = notificationPage.locator(SIGN_BUTTON_SELECTORS).first();
  const scrollButton = notificationPage.locator(SCROLL_BUTTON_SELECTOR);
  const messageContainer = notificationPage.locator(SIGNATURE_MESSAGE_SELECTOR);

  await signButton.waitFor({ state: "visible", timeout: 30_000 });

  const enableDeadline = Date.now() + 30_000;
  while (Date.now() < enableDeadline) {
    if (notificationPage.isClosed()) {
      return;
    }
    if (await signButton.isEnabled().catch(() => false)) {
      break;
    }

    if (await scrollButton.isVisible().catch(() => false)) {
      await scrollButton.click({ force: true });
    } else if (await messageContainer.isVisible().catch(() => false)) {
      await messageContainer.click({ force: true });
      await notificationPage.keyboard.press("End");
      await notificationPage.mouse.wheel(0, 800);
    } else {
      await notificationPage.keyboard.press("End");
      await notificationPage.mouse.wheel(0, 800);
    }

    try {
      await notificationPage.waitForTimeout(250);
    } catch {
      return;
    }
  }

  if (notificationPage.isClosed()) {
    return;
  }

  await signButton.click().catch(() => {
    /* Click may fail if button is disabled or page closed */
  });

  const riskButton = notificationPage.locator(RISK_SIGN_BUTTON_SELECTOR);
  if (notificationPage.isClosed()) {
    return;
  }

  if (await riskButton.isVisible().catch(() => false)) {
    await riskButton.click().catch(() => {
      /* Click may fail if modal closed */
    });
  }
}

export async function confirmTransaction(
  metamask: MetaMask,
  options?: { timeoutMs?: number; allowMissing?: boolean }
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 12_000;
  try {
    await withTimeout(metamask.confirmTransaction(), timeoutMs);
    return true;
  } catch {
    // fall back to manual flow
  }

  try {
    const notificationPage = await findNotificationPage(
      metamask,
      options?.timeoutMs ?? 30_000
    );
    await notificationPage.bringToFront();

    if (notificationPage.isClosed()) {
      return true;
    }

    const gasWarning = notificationPage.locator(GAS_WARNING_SELECTOR);
    if (await gasWarning.isVisible().catch(() => false)) {
      await notificationPage.keyboard.press("End");
    }

    await clickProceedAnyway(notificationPage);

    if (notificationPage.isClosed()) {
      return true;
    }

    const confirmButton = notificationPage
      .locator(CONFIRM_BUTTON_SELECTOR)
      .first();
    await confirmButton.waitFor({ state: "visible", timeout: 30_000 });

    const enableDeadline = Date.now() + 30_000;
    while (Date.now() < enableDeadline) {
      if (notificationPage.isClosed()) {
        return true;
      }
      if (await confirmButton.isEnabled().catch(() => false)) {
        break;
      }

      await clickProceedAnyway(notificationPage);

      if (notificationPage.isClosed()) {
        return true;
      }

      if (await gasWarning.isVisible().catch(() => false)) {
        await notificationPage.keyboard.press("End");
      }

      await confirmButton.scrollIntoViewIfNeeded().catch(() => {
        /* Scroll may fail if element is not attached */
      });
      await notificationPage.keyboard.press("PageDown");
      await notificationPage.mouse.wheel(0, 800);
      await notificationPage.waitForTimeout(250);
    }

    if (notificationPage.isClosed()) {
      return true;
    }

    await confirmButton.scrollIntoViewIfNeeded().catch(() => {
      /* Scroll may fail if element is not attached */
    });
    await confirmButton.click().catch(() => {
      /* Click may fail if page closed mid-operation */
    });
    return true;
  } catch (error) {
    if (options?.allowMissing) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("notification window not found")) {
        return false;
      }
    }
    throw error;
  }
}
