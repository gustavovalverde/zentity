import { z } from "zod";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";

// Step 1: Email only (minimal friction)
export const emailSchema = z.object({
  email: z.email({ message: "Please enter a valid email address" }),
});

// Step 4: Password (collected at the end, with confirmation)
export const passwordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, {
        message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      })
      .max(PASSWORD_MAX_LENGTH, {
        message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
      }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const idUploadSchema = z.object({
  idDocument: z.instanceof(File).nullable().optional(),
});

export const selfieSchema = z.object({
  selfieImage: z.string().nullable().optional(),
});

// Document AI processing result
export const documentResultSchema = z
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

export type DocumentResultData = z.infer<typeof documentResultSchema>;

export type EmailData = z.infer<typeof emailSchema>;
export type PasswordData = z.infer<typeof passwordSchema>;
export type IdUploadData = z.infer<typeof idUploadSchema>;
export type SelfieData = z.infer<typeof selfieSchema>;

/**
 * Wizard Data - Redesigned flow
 *
 * New flow: Email → ID Upload → Selfie/Liveness → Review & Complete
 *
 * - Email collected upfront (minimal friction)
 * - Name, DOB, etc. extracted from document (no manual input)
 * - Password collected at the end (after verification)
 * - Account created only after liveness verification (security)
 */
export interface WizardData {
  // Step 1: Email only
  email: string;

  // Step 2: ID Upload - file and extracted data
  idDocument: File | null;
  idDocumentBase64: string | null;
  documentResult: DocumentResultData | null;
  // Extracted from document (no manual input)
  extractedName: string | null;
  extractedDOB: string | null;
  extractedDocNumber: string | null;
  extractedNationality: string | null;
  extractedExpirationDate: string | null;

  // Step 3: Selfie/Liveness
  selfieImage: string | null;
  bestSelfieFrame: string | null;
  blinkCount: number | null;

  // Step 4: Review & Complete
  password: string;
  confirmPassword: string;
  preferredName: string | null; // Optional display name
}

export const defaultWizardData: WizardData = {
  // Step 1
  email: "",
  // Step 2
  idDocument: null,
  idDocumentBase64: null,
  documentResult: null,
  extractedName: null,
  extractedDOB: null,
  extractedDocNumber: null,
  extractedNationality: null,
  extractedExpirationDate: null,
  // Step 3
  selfieImage: null,
  bestSelfieFrame: null,
  blinkCount: null,
  // Step 4
  password: "",
  confirmPassword: "",
  preferredName: null,
};
