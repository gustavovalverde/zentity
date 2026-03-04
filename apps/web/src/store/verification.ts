import type { DocumentResult } from "@/lib/identity/document/document-ocr";

import { create } from "zustand";

/**
 * Verification Store
 *
 * In-memory state for the identity verification flow.
 * NO persistence — verification is atomic. If the user refreshes,
 * all state is lost and they restart from the document step.
 *
 * This is intentional: PII (DOB, document images, nationality) must never
 * be written to sessionStorage, localStorage, or URL params.
 * Client-side navigation preserves this state between verification steps.
 */
interface VerificationStore {
  bestSelfieFrame: string | null;
  documentResult: DocumentResult | null;
  // Draft and document references (from server)
  draftId: string | null;
  extractedDOB: string | null;
  extractedDocNumber: string | null;
  extractedExpirationDate: string | null;
  extractedFirstName: string | null;
  extractedLastName: string | null;

  // Extracted data from server OCR response
  extractedName: string | null;
  extractedNationality: string | null;
  extractedNationalityCode: string | null;

  // Transient document data (for processing)
  idDocument: File | null;
  idDocumentBase64: string | null;
  reset: () => void;

  // Transient selfie data (from liveness flow)
  selfieImage: string | null;

  // Actions
  set: (data: Partial<Omit<VerificationStore, "set" | "reset">>) => void;
  userSalt: string | null;
  verificationId: string | null;
}

const initialState: Omit<VerificationStore, "set" | "reset"> = {
  draftId: null,
  verificationId: null,
  idDocument: null,
  idDocumentBase64: null,
  documentResult: null,
  selfieImage: null,
  bestSelfieFrame: null,
  extractedName: null,
  extractedFirstName: null,
  extractedLastName: null,
  extractedDOB: null,
  extractedDocNumber: null,
  extractedNationality: null,
  extractedNationalityCode: null,
  extractedExpirationDate: null,
  userSalt: null,
};

export const useVerificationStore = create<VerificationStore>()((set) => ({
  ...initialState,
  set: (data) => set(data),
  reset: () => set(initialState),
}));
