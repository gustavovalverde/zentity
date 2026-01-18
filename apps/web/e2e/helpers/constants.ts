/**
 * Shared constants for E2E tests.
 *
 * Centralizes regex patterns, URLs, and test data to ensure consistency
 * across all E2E tests and make maintenance easier.
 */

/**
 * Common regex patterns used in E2E tests for assertions.
 */
export const PATTERNS = {
  // Page headings and content
  WELCOME_HEADING: /welcome|dashboard|home/i,
  SIGN_IN_HEADING: /sign in|log in|login/i,
  SIGN_UP_HEADING: /sign up|create account|register/i,
  ERROR_MESSAGE: /error|failed|invalid|something went wrong/i,
  SUCCESS_MESSAGE: /success|completed|verified/i,

  // URL patterns
  SIGN_IN_URL: /\/sign-in/,
  SIGN_UP_URL: /\/sign-up/,
  DASHBOARD_URL: /\/dashboard/,
  VERIFICATION_URL: /\/dashboard\/verify/,
  SETTINGS_URL: /\/settings/,

  // Verification steps
  DOCUMENT_UPLOAD_STEP: /upload.*document|document.*upload|scan.*id/i,
  LIVENESS_STEP: /liveness|face.*check|verify.*identity/i,
  REVIEW_STEP: /review|confirm|summary/i,

  // Web3 patterns
  WALLET_CONNECTED: /connected|0x[a-fA-F0-9]{4,}/i,
  TRANSACTION_HASH: /^0x[a-fA-F0-9]{64}$/,
  ETH_ADDRESS: /^0x[a-fA-F0-9]{40}$/,
};

/**
 * URL paths used in E2E navigation.
 */
export const URLS = {
  HOME: "/",
  SIGN_IN: "/sign-in",
  SIGN_UP: "/sign-up",
  DASHBOARD: "/dashboard",
  SETTINGS: "/settings",
  VERIFICATION: "/dashboard/verify",
  WEB3_DEMO: "/demo",
  DEFI_DEMO: "/defi-demo",
} as const;

/**
 * Test user credentials and data.
 */
export const TEST_USER = {
  email: "e2e-test@zentity.xyz",
  password: "TestPassword123!",
  name: "E2E Test User",
} as const;

/**
 * Test wallet addresses for Web3 testing.
 */
export const TEST_WALLETS = {
  // Hardhat default accounts
  HARDHAT_ACCOUNT_0: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  HARDHAT_ACCOUNT_1: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  HARDHAT_PRIVATE_KEY_0:
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
} as const;

/**
 * Timeouts for various operations in E2E tests.
 */
export const TIMEOUTS = {
  // Navigation and page load
  PAGE_LOAD: 30_000,
  NAVIGATION: 15_000,

  // Authentication
  SIGN_IN: 10_000,
  SIGN_UP: 15_000,

  // Document processing
  DOCUMENT_UPLOAD: 30_000,
  OCR_PROCESSING: 45_000,

  // Liveness verification
  LIVENESS_SESSION: 60_000,
  LIVENESS_CHALLENGE: 15_000,

  // Blockchain operations
  WALLET_CONNECT: 15_000,
  TRANSACTION_SUBMIT: 30_000,
  TRANSACTION_CONFIRM: 120_000,

  // General
  SHORT: 5000,
  MEDIUM: 15_000,
  LONG: 60_000,
} as const;

/**
 * Test document data for verification tests.
 */
export const TEST_DOCUMENTS = {
  PASSPORT: {
    type: "passport",
    country: "USA",
    fullName: "Test User",
    dateOfBirth: "1990-01-15",
    expiryDate: "2030-01-15",
    documentNumber: "P123456789",
  },
  DRIVERS_LICENSE: {
    type: "drivers_license",
    country: "USA",
    fullName: "Test User",
    dateOfBirth: "1990-01-15",
    expiryDate: "2028-06-30",
    documentNumber: "DL987654321",
  },
} as const;

/**
 * Selectors for common UI elements.
 * Use data-testid attributes when available for stability.
 */
export const SELECTORS = {
  // Auth forms
  EMAIL_INPUT:
    '[data-testid="email-input"], input[type="email"], input[name="email"]',
  PASSWORD_INPUT:
    '[data-testid="password-input"], input[type="password"], input[name="password"]',
  SUBMIT_BUTTON: '[data-testid="submit-button"], button[type="submit"]',

  // Navigation
  NAV_DASHBOARD: '[data-testid="nav-dashboard"], a[href="/dashboard"]',
  NAV_SETTINGS: '[data-testid="nav-settings"], a[href="/settings"]',
  NAV_SIGN_OUT: '[data-testid="nav-sign-out"], button:has-text("Sign out")',

  // Onboarding
  DOCUMENT_DROPZONE: '[data-testid="document-dropzone"]',
  WEBCAM_PREVIEW: '[data-testid="webcam-preview"]',
  CAPTURE_BUTTON: '[data-testid="capture-button"]',
  NEXT_STEP_BUTTON:
    '[data-testid="next-step"], button:has-text("Next"), button:has-text("Continue")',

  // Web3
  CONNECT_WALLET_BUTTON:
    '[data-testid="connect-wallet"], button:has-text("Connect Wallet")',
  WALLET_ADDRESS: '[data-testid="wallet-address"]',
  SUBMIT_ATTESTATION_BUTTON: '[data-testid="submit-attestation"]',
} as const;
