/**
 * E2E tests for tier progression and feature gating.
 *
 * These tests verify the tier system UI works correctly:
 * - Tier badge displays current tier
 * - Progress card shows requirements
 * - Locked features display tier requirements
 */
import { expect, test } from "@playwright/test";

// Regex patterns compiled once at module level
const DASHBOARD_URL_PATTERN = /\/dashboard/;
const TIER_BADGE_PATTERN = /Tier \d: (Explore|Account|Verified|Auditable)/i;
const TIER_2_VERIFIED_PATTERN = /Tier 2: Verified/i;
const IDENTITY_PROGRESS_PATTERN = /Identity Progress/i;
const COMPLETE_VERIFICATION_PATTERN = /Complete Verification/i;
const WHAT_YOU_CAN_DO_PATTERN = /What You Can Do/i;
const VERIFIABLE_CREDENTIALS_PATTERN = /Verifiable Credentials/i;
const GET_CREDENTIALS_PATTERN = /Get Credentials/i;
const WELCOME_BACK_PATTERN = /Welcome back/i;
const REQUIREMENTS_TIER_3_PATTERN = /Requirements for Tier 3/i;

test.describe("Tier System - Dashboard Display", () => {
  test("should display tier badge on dashboard", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);
    await expect(page.getByText(WELCOME_BACK_PATTERN).first()).toBeVisible({
      timeout: 30_000,
    });

    // Tier badge should be visible (format: "Tier X: Label")
    const tierBadge = page.getByText(TIER_BADGE_PATTERN);
    await expect(tierBadge.first()).toBeVisible({ timeout: 10_000 });
  });

  test("should display Tier 2: Verified for seeded user", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);

    // The E2E seeded user has document + liveness + face_match, so Tier 2
    const tier2Badge = page.getByText(TIER_2_VERIFIED_PATTERN);
    await expect(tier2Badge.first()).toBeVisible({ timeout: 15_000 });
  });

  test("should display identity progress card", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);

    // Progress card should be visible for users not at Tier 3
    const progressCard = page.getByText(IDENTITY_PROGRESS_PATTERN);
    await expect(progressCard.first()).toBeVisible({ timeout: 15_000 });
  });

  test("should show complete verification CTA for non-max tier users", async ({
    page,
  }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);

    // "Complete Verification" button should be visible for Tier 2 (not Tier 3)
    const completeVerificationBtn = page.getByRole("link", {
      name: COMPLETE_VERIFICATION_PATTERN,
    });
    await expect(completeVerificationBtn).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Tier System - Feature Gating", () => {
  test("should display identity actions card", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);

    // "What You Can Do" card should be visible
    const actionsCard = page.getByText(WHAT_YOU_CAN_DO_PATTERN);
    await expect(actionsCard.first()).toBeVisible({ timeout: 15_000 });
  });

  test("should show verifiable credentials action", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);

    // Verifiable Credentials should be visible
    const credentialsTitle = page.getByText(VERIFIABLE_CREDENTIALS_PATTERN);
    await expect(credentialsTitle.first()).toBeVisible({ timeout: 15_000 });
  });

  test("should enable get credentials for Tier 2 user", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);

    // For Tier 2 user, "Get Credentials" should be unlocked (not "Unlock with Verification")
    const getCredentialsBtn = page.getByRole("link", {
      name: GET_CREDENTIALS_PATTERN,
    });
    await expect(getCredentialsBtn).toBeVisible({ timeout: 15_000 });

    // Should link to credentials page, not verification page
    const href = await getCredentialsBtn.getAttribute("href");
    expect(href).toContain("/credentials");
  });
});

test.describe("Tier System - Progress Tracking", () => {
  test("should show progress percentage on dashboard", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);

    // Progress percentage should be visible (e.g., "67%")
    const progressText = page.locator("text=/\\d+%/");
    await expect(progressText.first()).toBeVisible({ timeout: 15_000 });
  });

  test("should display tier requirements for next tier", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);

    // Should show "Requirements for Tier 3:" since user is at Tier 2
    const requirementsText = page.getByText(REQUIREMENTS_TIER_3_PATTERN);
    await expect(requirementsText.first()).toBeVisible({ timeout: 15_000 });
  });
});
