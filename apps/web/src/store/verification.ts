import type { DocumentResult } from "@/lib/identity/document/document-ocr";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Verification Store
 *
 * Manages form data for the dashboard identity verification flow.
 * Contains transient data needed during document upload, liveness, and face match.
 *
 * Important: Verification status (documentProcessed, livenessPassed, faceMatchPassed)
 * is NOT stored here - these are server-authoritative via getTierProfile().
 * This store only holds client-side transient data for the verification UI.
 */
interface VerificationStore {
  // Draft and document references (from server)
  draftId: string | null;
  documentId: string | null;

  // Transient document data (for processing, not persisted to server)
  idDocument: File | null;
  idDocumentBase64: string | null;
  documentResult: DocumentResult | null;

  // Transient selfie data (from liveness flow)
  selfieImage: string | null;
  bestSelfieFrame: string | null;

  // Extracted data for display (from server OCR response)
  extractedName: string | null;
  extractedDOB: string | null;
  extractedDocNumber: string | null;
  extractedNationality: string | null;
  extractedNationalityCode: string | null;
  extractedExpirationDate: string | null;
  userSalt: string | null;

  // Actions
  set: (data: Partial<Omit<VerificationStore, "set" | "reset">>) => void;
  reset: () => void;
}

const initialState: Omit<VerificationStore, "set" | "reset"> = {
  draftId: null,
  documentId: null,
  idDocument: null,
  idDocumentBase64: null,
  documentResult: null,
  selfieImage: null,
  bestSelfieFrame: null,
  extractedName: null,
  extractedDOB: null,
  extractedDocNumber: null,
  extractedNationality: null,
  extractedNationalityCode: null,
  extractedExpirationDate: null,
  userSalt: null,
};

export const useVerificationStore = create<VerificationStore>()(
  persist(
    (set) => ({
      ...initialState,
      set: (data) => set(data),
      reset: () => set(initialState),
    }),
    {
      name: "zentity-verification",
      partialize: (state) => ({
        // Persist data needed to resume verification flow across page navigations
        draftId: state.draftId,
        documentId: state.documentId,
        idDocumentBase64: state.idDocumentBase64,
        // Extracted data needed for ZK proof generation after liveness
        extractedDOB: state.extractedDOB,
        extractedNationalityCode: state.extractedNationalityCode,
        extractedExpirationDate: state.extractedExpirationDate,
        userSalt: state.userSalt,
      }),
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
