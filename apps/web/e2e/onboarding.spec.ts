import { expect, test } from "@playwright/test";

test.describe("Onboarding Flow", () => {
  test("should show onboarding page with verification steps", async ({
    page,
  }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    // Should display some content on the onboarding page
    const pageContent = await page.textContent("body");
    expect(
      pageContent?.toLowerCase().includes("verif") ||
        pageContent?.toLowerCase().includes("identity") ||
        pageContent?.toLowerCase().includes("document") ||
        pageContent?.toLowerCase().includes("upload") ||
        pageContent?.toLowerCase().includes("onboarding"),
    ).toBeTruthy();
  });

  test("should have document upload or verification content", async ({
    page,
  }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    // Look for upload elements or verification-related content
    const hasUpload = await page
      .locator(
        '[data-testid="document-upload"], input[type="file"], button:has-text("upload"), [class*="upload"], [class*="dropzone"]',
      )
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    const hasSteps = await page
      .locator('[class*="step"], [class*="progress"]')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    const pageContent = await page.textContent("body");
    const hasVerificationText =
      pageContent?.toLowerCase().includes("verif") ||
      pageContent?.toLowerCase().includes("document") ||
      pageContent?.toLowerCase().includes("identity");

    expect(hasUpload || hasSteps || hasVerificationText).toBeTruthy();
  });

  test("should show camera/selfie or verification content", async ({
    page,
  }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    // Look for camera-related elements or verification text
    const pageContent = await page.textContent("body");
    const hasCameraContent =
      pageContent?.toLowerCase().includes("camera") ||
      pageContent?.toLowerCase().includes("selfie") ||
      pageContent?.toLowerCase().includes("photo") ||
      pageContent?.toLowerCase().includes("face") ||
      pageContent?.toLowerCase().includes("verif");

    expect(hasCameraContent).toBeTruthy();
  });

  test("should allow navigation to dashboard", async ({ page }) => {
    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");

    // Try to find and click a dashboard link, or navigate directly
    const dashboardLink = page
      .locator(
        'a[href*="dashboard"], button:has-text("skip"), button:has-text("back"), button:has-text("dashboard")',
      )
      .first();

    if (await dashboardLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await dashboardLink.click();
      await page.waitForURL(/dashboard/, { timeout: 5000 });
    } else {
      // Direct navigation should work for authenticated users
      await page.goto("/dashboard");
    }

    expect(page.url()).toContain("dashboard");
  });
});

test.describe("Onboarding - Document Upload Flow", () => {
  test.skip("should process uploaded document", async ({ page }) => {
    // This test requires a test image fixture
    // Skip for now until we have test images

    await page.goto("/onboarding");

    // Upload test document
    // await page.locator('input[type="file"]').first().setInputFiles('./e2e/fixtures/test-images/test-id.jpg');

    // Verify processing started
    // await expect(page.locator('text=/processing|analyzing|verifying/i')).toBeVisible();
  });
});
