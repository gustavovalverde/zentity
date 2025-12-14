/**
 * Root tRPC Router
 *
 * Composes all domain routers into a single application router.
 * This is the main entry point for all tRPC API calls.
 *
 * Routers:
 * - crypto: FHE encryption, ZK proof verification, challenge management
 * - identity: Full identity verification (document + selfie + liveness)
 * - kyc: Document OCR processing
 * - liveness: Multi-gesture liveness detection sessions
 * - onboarding: Wizard state management and step validation
 */
import "server-only";

import { router } from "../server";
import { cryptoRouter } from "./crypto";
import { identityRouter } from "./identity";
import { kycRouter } from "./kyc";
import { livenessRouter } from "./liveness";
import { onboardingRouter } from "./onboarding";

export const appRouter = router({
  crypto: cryptoRouter,
  identity: identityRouter,
  kyc: kycRouter,
  liveness: livenessRouter,
  onboarding: onboardingRouter,
});

/** Type export for client-side type inference. */
export type AppRouter = typeof appRouter;
