/**
 * Root tRPC Router
 *
 * Composes all domain routers into a single application router.
 * This is the main entry point for all tRPC API calls.
 *
 * Routers:
 * - account: Account management and GDPR deletion
 * - attestation: On-chain identity attestation (multi-network)
 * - credentials: Verifiable credential issuance (OIDC4VCI)
 * - crypto: FHE encryption, ZK proof verification, challenge management
 * - identity: Full identity verification (document + selfie + liveness)
 * - liveness: Multi-gesture liveness detection sessions
 * - onboarding: Wizard state management and step validation
 * - secrets: Passkey-wrapped secret storage
 * - token: CompliantERC20 token operations (DeFi demo)
 */
import "server-only";

import { router } from "../server";
import { accountRouter } from "./account";
import { attestationRouter } from "./attestation";
import { credentialsRouter } from "./credentials";
import { cryptoRouter } from "./crypto/router";
import { identityRouter } from "./identity/router";
import { livenessRouter } from "./liveness";
import { onboardingRouter } from "./onboarding";
import { recoveryRouter } from "./recovery/router";
import { secretsRouter } from "./secrets";
import { tokenRouter } from "./token";

export const appRouter = router({
  account: accountRouter,
  attestation: attestationRouter,
  credentials: credentialsRouter,
  crypto: cryptoRouter,
  identity: identityRouter,
  liveness: livenessRouter,
  onboarding: onboardingRouter,
  recovery: recoveryRouter,
  secrets: secretsRouter,
  token: tokenRouter,
});

/** Type export for client-side type inference. */
export type AppRouter = typeof appRouter;
