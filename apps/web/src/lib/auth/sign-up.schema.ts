import z from "zod";

// Step 1: Email (optional for anonymous onboarding)
export const emailSchema = z.object({
  email: z.email({ message: "Please enter a valid email address" }),
});

// Document AI processing result
const documentResultSchema = z
  .object({
    documentType: z.enum([
      "passport",
      "national_id",
      "drivers_license",
      "unknown",
    ]),
    documentOrigin: z.string().optional(), // ISO 3166-1 alpha-3 country code
    confidence: z.number(),
    extractedData: z
      .object({
        fullName: z.string().optional(),
        documentNumber: z.string().optional(),
        dateOfBirth: z.string().optional(),
        expirationDate: z.string().optional(),
        nationality: z.string().optional(),
        nationalityCode: z.string().optional(),
        gender: z.string().optional(),
      })
      .optional(),
    validationIssues: z.array(z.string()),
  })
  .nullable()
  .optional();

type DocumentResultData = z.infer<typeof documentResultSchema>;

/**
 * Wizard Data - Passwordless-first flow
 *
 * New flow: Email → ID Upload → Selfie/Liveness → Create Account with Passkey
 *
 * - Email collected upfront (minimal friction)
 * - Name, DOB, etc. extracted from document (no manual input)
 * - Account creation happens alongside passkey registration (passwordless)
 * - Passkey-secured keys required for privacy proofs and FHE storage
 * - Optional password can be added later in settings
 */
export interface WizardData {
  // Step 1: Email only
  email: string | null;

  // Step 2: ID Upload - file and extracted data
  idDocument: File | null;
  idDocumentBase64: string | null;
  documentResult: DocumentResultData | null;
  identityDraftId: string | null;
  // Extracted from document (no manual input)
  extractedName: string | null;
  extractedDOB: string | null;
  extractedDocNumber: string | null;
  extractedNationality: string | null;
  extractedNationalityCode: string | null;
  extractedExpirationDate: string | null;
  userSalt: string | null;

  // Step 3: Selfie/Liveness
  selfieImage: string | null;
  bestSelfieFrame: string | null;

  // Step 4: Create Account with Passkey
  preferredName: string | null; // Optional display name (editable from extracted name)
  identityDocumentId: string | null;
}

const _defaultWizardData: WizardData = {
  // Step 1
  email: null,
  // Step 2
  idDocument: null,
  idDocumentBase64: null,
  documentResult: null,
  identityDraftId: null,
  extractedName: null,
  extractedDOB: null,
  extractedDocNumber: null,
  extractedNationality: null,
  extractedNationalityCode: null,
  extractedExpirationDate: null,
  userSalt: null,
  // Step 3
  selfieImage: null,
  bestSelfieFrame: null,
  // Step 4
  preferredName: null,
  identityDocumentId: null,
};
