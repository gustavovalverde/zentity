import { expect, test } from "@playwright/test";

const DASHBOARD_URL_PATTERN = /\/dashboard/;
const WELCOME_BACK_PATTERN = /Welcome back/i;
const IDENTITY_STATUS_PATTERN = /Identity Status/i;
const ANONYMOUS_TIER_PATTERN = /^Anonymous$/i;
const VERIFICATION_INCOMPLETE_PATTERN = /Verification Incomplete/i;
const INCOMPLETE_PROOFS_PATTERN =
  /Identity checks passed, but verification proofs still need to be generated\./i;
const COMPLETE_VERIFICATION_PATTERN = /Complete Verification/i;
const WHAT_YOU_CAN_DO_PATTERN = /What You Can Do/i;
const VERIFIABLE_CREDENTIALS_PATTERN = /Verifiable Credentials/i;
const ON_CHAIN_ATTESTATION_PATTERN = /On-Chain Attestation/i;
const TIER_2_BADGE_PATTERN = /^Tier 2$/i;
const UNLOCK_WITH_VERIFICATION_PATTERN = /Unlock with Verification/i;
const WEB3_BADGE_PATTERN = /^Web3$/i;

test.describe("Tier System - Dashboard Display", () => {
  test("shows the current dashboard tier badge", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);
    await expect(page.getByText(WELCOME_BACK_PATTERN).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(IDENTITY_STATUS_PATTERN).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(ANONYMOUS_TIER_PATTERN).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("shows the seeded user's incomplete verification state", async ({
    page,
  }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);
    await expect(
      page.getByText(VERIFICATION_INCOMPLETE_PATTERN).first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(INCOMPLETE_PROOFS_PATTERN).first()).toBeVisible(
      {
        timeout: 15_000,
      }
    );
  });

  test("routes the seeded user to proof regeneration", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const completeVerificationLink = page.getByRole("link", {
      name: COMPLETE_VERIFICATION_PATTERN,
    });

    await expect(completeVerificationLink).toBeVisible({ timeout: 15_000 });
    await expect(completeVerificationLink).toHaveAttribute(
      "href",
      "/dashboard/verify"
    );
  });
});

test.describe("Tier System - Feature Gating", () => {
  test("shows the current identity actions card", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN);
    await expect(page.getByText(WHAT_YOU_CAN_DO_PATTERN).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("keeps verifiable credentials locked behind tier 2", async ({
    page,
  }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(
      page.getByText(VERIFIABLE_CREDENTIALS_PATTERN).first()
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(TIER_2_BADGE_PATTERN).first()).toBeVisible({
      timeout: 15_000,
    });

    const unlockLinks = page.getByRole("link", {
      name: UNLOCK_WITH_VERIFICATION_PATTERN,
    });
    await expect(unlockLinks.first()).toBeVisible({ timeout: 15_000 });
    await expect(unlockLinks.first()).toHaveAttribute(
      "href",
      "/dashboard/verify"
    );
  });

  test("keeps on-chain attestation locked behind verification", async ({
    page,
  }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(
      page.getByText(ON_CHAIN_ATTESTATION_PATTERN).first()
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(WEB3_BADGE_PATTERN).first()).toBeVisible({
      timeout: 15_000,
    });

    const unlockLinks = page.getByRole("link", {
      name: UNLOCK_WITH_VERIFICATION_PATTERN,
    });
    await expect(unlockLinks.nth(1)).toBeVisible({ timeout: 15_000 });
    await expect(unlockLinks.nth(1)).toHaveAttribute(
      "href",
      "/dashboard/verify"
    );
  });
});
