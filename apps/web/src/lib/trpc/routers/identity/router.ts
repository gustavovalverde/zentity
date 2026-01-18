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
import { finalizeProcedure, finalizeStatusProcedure } from "./finalize";
import { livenessStatusProcedure } from "./liveness-status";
import { prepareDocumentProcedure } from "./prepare-document";

export const identityRouter = router({
  prepareDocument: prepareDocumentProcedure,
  livenessStatus: livenessStatusProcedure,
  finalize: finalizeProcedure,
  finalizeStatus: finalizeStatusProcedure,
});
