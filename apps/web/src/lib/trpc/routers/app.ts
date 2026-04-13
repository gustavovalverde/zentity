/**
 * Root tRPC Router
 *
 * Composes all domain routers into a single application router.
 * This is the main entry point for all tRPC API calls.
 *
 * Routers:
 * - account: Account management and GDPR deletion
 * - admin: JWKS key rotation, cleanup, on-chain revocation retry (admin-only)
 * - agent: Agent host/session registration and capability discovery
 * - assurance: Tier profile and feature gating
 * - attestation: On-chain identity attestation (multi-network)
 * - compliantToken: CompliantERC20 token operations (DeFi demo)
 * - credentials: Verifiable credential issuance (OIDC4VCI)
 * - identity: Identity verification (document OCR, proofs, revocation)
 * - liveness: Multi-gesture liveness detection sessions
 * - passportChip: ZKPassport NFC chip verification
 * - recovery: FROST guardian-based key recovery
 * - secrets: Passkey-wrapped secret storage
 * - signUp: Account creation wizard state management
 * - zk: ZK proof verification, storage, BBS+ credentials, challenge management
 */
import "server-only";

import { router } from "../server";
import { accountRouter } from "./account";
import { adminRouter } from "./admin";
import { agentRouter } from "./agent";
import { assuranceRouter } from "./assurance";
import { attestationRouter } from "./attestation";
import { compliantTokenRouter } from "./compliant-token";
import { credentialsRouter } from "./credentials";
import { identityRouter } from "./identity";
import { livenessRouter } from "./liveness";
import { passportChipRouter } from "./passport-chip";
import { recoveryRouter } from "./recovery";
import { secretsRouter } from "./secrets";
import { signUpRouter } from "./sign-up";
import { zkRouter } from "./zk";

export const appRouter = router({
  account: accountRouter,
  admin: adminRouter,
  agent: agentRouter,
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
