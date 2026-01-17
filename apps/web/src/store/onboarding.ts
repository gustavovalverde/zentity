import type { DocumentResult } from "@/lib/identity/document/document-ocr";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Onboarding Store
 *
 * Manages form data and server verification flags for the onboarding wizard.
 * Uses Zustand with persist middleware for draft data recovery.
 *
 * - Draft data (email only) is persisted to sessionStorage
 * - Transient data (files, images, step control config) is NOT persisted
 * - Server flags track verification progress
 */

export interface OnboardingStore {
  // Session (from server)
  sessionId: string | null;

  // Step 1: Email
  email: string | null;

  // Step 2: ID Upload - extracted data
  extractedName: string | null;
  extractedDOB: string | null;
  extractedDocNumber: string | null;
  extractedNationality: string | null;
  extractedNationalityCode: string | null;
  extractedExpirationDate: string | null;
  userSalt: string | null;
  identityDraftId: string | null;

  // Step 2: Transient (not persisted)
  idDocument: File | null;
  idDocumentBase64: string | null;
  documentResult: DocumentResult | null;

  // Step 3: Transient (not persisted)
  selfieImage: string | null;
  bestSelfieFrame: string | null;

  // Step 4
  preferredName: string | null;
  identityDocumentId: string | null;

  // Server verification flags
  documentProcessed: boolean;
  livenessPassed: boolean;
  faceMatchPassed: boolean;
  keysSecured: boolean;

  // Actions
  set: (data: Partial<OnboardingStore>) => void;
  reset: () => void;
}

const initialState: Omit<OnboardingStore, "set" | "reset"> = {
  sessionId: null,
  email: null,
  extractedName: null,
  extractedDOB: null,
  extractedDocNumber: null,
  extractedNationality: null,
  extractedNationalityCode: null,
  extractedExpirationDate: null,
  userSalt: null,
  identityDraftId: null,
  idDocument: null,
  idDocumentBase64: null,
  documentResult: null,
  selfieImage: null,
  bestSelfieFrame: null,
  preferredName: null,
  identityDocumentId: null,
  documentProcessed: false,
  livenessPassed: false,
  faceMatchPassed: false,
  keysSecured: false,
};

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set) => ({
      ...initialState,
      set: (data) => set(data),
      reset: () => set(initialState),
    }),
    {
      name: "zentity-onboarding",
      partialize: (state) => ({
        // Only persist email to reduce PII exposure on shared devices.
        email: state.email,
      }),
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
