/**
 * Root tRPC Router
 *
 * Composes all domain routers into a single application router.
 * This is the main entry point for all tRPC API calls.
 *
 * Routers:
 * - account: Account management and GDPR deletion
 * - agentBoundaries: Per-user, per-agent auto-approval policies
 * - assurance: Tier profile and feature gating
 * - attestation: On-chain identity attestation (multi-network)
 * - credentials: Verifiable credential issuance (OIDC4VCI)
 * - crypto: FHE encryption, ZK proof verification, challenge management
 * - identity: Full identity verification (document + selfie + liveness)
 * - liveness: Multi-gesture liveness detection sessions
 * - signUp: Account creation wizard state management
 * - secrets: Passkey-wrapped secret storage
 * - compliantToken: CompliantERC20 token operations (DeFi demo)
 */
import "server-only";

import { router } from "../server";
import { accountRouter } from "./account";
import { adminRouter } from "./admin";
import { agentBoundariesRouter } from "./agent-boundaries";
import { assuranceRouter } from "./assurance";
import { attestationRouter } from "./attestation";
import { compliantTokenRouter } from "./compliant-token";
import { credentialsRouter } from "./credentials";
import { identityRouter } from "./identity/router";
import { livenessRouter } from "./liveness";
import { passportChipRouter } from "./passport-chip";
import { recoveryRouter } from "./recovery/router";
import { secretsRouter } from "./secrets";
import { signUpRouter } from "./sign-up";
import { zkRouter } from "./zk/router";

export const appRouter = router({
  account: accountRouter,
  admin: adminRouter,
  agentBoundaries: agentBoundariesRouter,
  assurance: assuranceRouter,
  attestation: attestationRouter,
  credentials: credentialsRouter,
  zk: zkRouter,
  identity: identityRouter,
  liveness: livenessRouter,
  passportChip: passportChipRouter,
  recovery: recoveryRouter,
  secrets: secretsRouter,
  signUp: signUpRouter,
  compliantToken: compliantTokenRouter,
});

/** Type export for client-side type inference. */
export type AppRouter = typeof appRouter;
