/**
 * Identity Router
 *
 * Orchestrates the full identity verification flow:
 * 1. Document OCR + commitment generation (privacy-preserving hashes)
 * 2. Face detection on selfie with anti-spoofing checks
 * 3. Face matching between document photo and selfie
 * 4. Queue FHE encryption of sensitive fields (birth year offset, country code, liveness score)
 * 5. Nationality commitment generation
 *
 * Privacy principle: Raw PII is never stored. Only cryptographic commitments,
 * FHE ciphertexts, and verification flags are persisted. Images are processed
 * transiently and discarded.
 */
import "server-only";

import { router } from "../../server";
import {
  fheStatusProcedure,
  finalizeAsyncProcedure,
  finalizeStatusProcedure,
  prepareLivenessProcedure,
  statusProcedure,
} from "./finalize";
import { prepareDocumentProcedure } from "./prepare-document";
import { processDocumentProcedure } from "./process-document";
import { verifyNameProcedure, verifyProcedure } from "./verify";

export type {
  FheStatus,
  VerifyIdentityResponse,
} from "./helpers/job-processor";

export const identityRouter = router({
  processDocument: processDocumentProcedure,
  prepareDocument: prepareDocumentProcedure,
  status: statusProcedure,
  fheStatus: fheStatusProcedure,
  prepareLiveness: prepareLivenessProcedure,
  finalizeAsync: finalizeAsyncProcedure,
  finalizeStatus: finalizeStatusProcedure,
  verify: verifyProcedure,
  verifyName: verifyNameProcedure,
});
