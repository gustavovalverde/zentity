/**
 * Root tRPC Router
 *
 * Composes all domain routers into a single application router.
 * This is the main entry point for all tRPC API calls.
 *
 * Routers:
 * - account: Account management and GDPR deletion
 * - attestation: On-chain identity attestation (multi-network)
 * - crypto: FHE encryption, ZK proof verification, challenge management
 * - identity: Full identity verification (document + selfie + liveness)
 * - kyc: Document OCR processing
 * - liveness: Multi-gesture liveness detection sessions
 * - onboarding: Wizard state management and step validation
 * - token: CompliantERC20 token operations (DeFi demo)
 */
import "server-only";

import { router } from "../server";
import { accountRouter } from "./account";
import { attestationRouter } from "./attestation";
import { cryptoRouter } from "./crypto";
import { identityRouter } from "./identity";
import { kycRouter } from "./kyc";
import { livenessRouter } from "./liveness";
import { onboardingRouter } from "./onboarding";
import { tokenRouter } from "./token";

export const appRouter = router({
  account: accountRouter,
  attestation: attestationRouter,
  crypto: cryptoRouter,
  identity: identityRouter,
  kyc: kycRouter,
  liveness: livenessRouter,
  onboarding: onboardingRouter,
  token: tokenRouter,
});

/** Type export for client-side type inference. */
export type AppRouter = typeof appRouter;
