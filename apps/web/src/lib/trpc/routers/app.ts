/**
 * Root tRPC Router
 *
 * Composes all domain routers into a single application router.
 * This is the main entry point for all tRPC API calls.
 *
 * Routers:
 * - account: Account management and GDPR deletion
 * - assurance: Tier profile and feature gating
 * - attestation: On-chain identity attestation (multi-network)
 * - credentials: Verifiable credential issuance (OIDC4VCI)
 * - crypto: FHE encryption, ZK proof verification, challenge management
 * - identity: Full identity verification (document + selfie + liveness)
 * - liveness: Multi-gesture liveness detection sessions
 * - signUp: Account creation wizard state management
 * - secrets: Passkey-wrapped secret storage
 * - token: CompliantERC20 token operations (DeFi demo)
 */
import "server-only";

import { router } from "../server";
import { accountRouter } from "./account";
import { assuranceRouter } from "./assurance";
import { attestationRouter } from "./attestation";
import { credentialsRouter } from "./credentials";
import { cryptoRouter } from "./crypto/router";
import { identityRouter } from "./identity/router";
import { livenessRouter } from "./liveness";
import { recoveryRouter } from "./recovery/router";
import { secretsRouter } from "./secrets";
import { signUpRouter } from "./sign-up";
import { tokenRouter } from "./token";

export const appRouter = router({
  account: accountRouter,
  assurance: assuranceRouter,
  attestation: attestationRouter,
  credentials: credentialsRouter,
  crypto: cryptoRouter,
  identity: identityRouter,
  liveness: livenessRouter,
  recovery: recoveryRouter,
  secrets: secretsRouter,
  signUp: signUpRouter,
  token: tokenRouter,
});

/** Type export for client-side type inference. */
export type AppRouter = typeof appRouter;
