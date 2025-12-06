/**
 * Document AI processing with local-first approach.
 *
 * Priority order:
 * 1. RapidOCR service (fast, local, privacy-first)
 * 2. Vercel AI Gateway (cloud fallback)
 *
 * Supports:
 * - Document type detection (passport, cedula, driver's license)
 * - DR document validation
 * - Field extraction (name, document number, DOB, etc.)
 */

import { generateObject, gateway } from "ai";
import { z } from "zod";

// Schema for extracted document data
const DocumentSchema = z.object({
  documentType: z.enum(["passport", "cedula", "drivers_license", "unknown"]),
  isValidDRDocument: z.boolean(),
  confidence: z.number().min(0).max(1),
  extractedData: z
    .object({
      fullName: z.string().optional(),
      firstName: z.string().optional(),  // Nombres
      lastName: z.string().optional(),   // Apellidos
      documentNumber: z.string().optional(),
      dateOfBirth: z.string().optional(),
      expirationDate: z.string().optional(),
      nationality: z.string().optional(),
      gender: z.string().optional(),
    })
    .optional(),
  validationIssues: z.array(z.string()),
});

export type DocumentResult = z.infer<typeof DocumentSchema>;

// Document types for display
export const DOCUMENT_TYPE_LABELS: Record<DocumentResult["documentType"], string> = {
  passport: "Passport",
  cedula: "Cedula (ID Card)",
  drivers_license: "Driver's License",
  unknown: "Unknown Document",
};

// Configuration
const USE_OCR_SERVICE = process.env.USE_OCR_SERVICE !== "false";

// Helper to get the base URL for API calls (works both client and server side)
function getBaseUrl(): string {
  // Server-side: use environment variable
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  }
  // Client-side: use relative URL (browser adds hostname)
  return "";
}

/**
 * Process document using Vercel AI Gateway (cloud)
 */
async function processDocumentCloud(imageBase64: string): Promise<DocumentResult> {
  // Remove data URL prefix if present
  const cleanImage = imageBase64.includes(",")
    ? imageBase64.split(",")[1]
    : imageBase64;

  const result = await generateObject({
    model: gateway("anthropic/claude-sonnet-4.5"),
    schema: DocumentSchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", image: cleanImage },
          {
            type: "text",
            text: `Analyze this identity document image.

1. Identify if this is a Dominican Republic passport, cedula (ID card), or driver's license
2. Verify it appears to be a genuine DR document by looking for:
   - "REPÚBLICA DOMINICANA" text
   - Dominican coat of arms or official emblems
   - Expected layout and formatting for DR documents
3. Extract key fields if visible:
   - Full name (nombre completo)
   - Document number (número de documento)
   - Date of birth (fecha de nacimiento)
   - Expiration date (fecha de vencimiento)
   - Nationality (nacionalidad)
   - Gender (sexo)

Rules:
- If this is NOT a Dominican Republic document, set isValidDRDocument to false
- If any fields are unclear, blurry, or not visible, omit them from extractedData
- List any validation concerns in validationIssues (e.g., "document appears expired", "image quality too low", "not a DR document")
- Set confidence based on how clearly you can read and verify the document (0.0-1.0)`,
          },
        ],
      },
    ],
  });

  return result.object;
}

/**
 * Process document using RapidOCR service
 */
async function processDocumentOCR(imageBase64: string): Promise<DocumentResult> {
  // Remove data URL prefix if present
  const cleanImage = imageBase64.includes(",")
    ? imageBase64.split(",")[1]
    : imageBase64;

  const response = await fetch(`${getBaseUrl()}/api/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: cleanImage }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OCR service error: ${error}`);
  }

  const data = await response.json();

  // Map response to DocumentResult
  return {
    documentType: data.documentType || "unknown",
    isValidDRDocument: Boolean(data.isValidDRDocument),
    confidence: data.confidence || 0,
    extractedData: data.extractedData
      ? {
          fullName: data.extractedData.fullName || undefined,
          firstName: data.extractedData.firstName || undefined,
          lastName: data.extractedData.lastName || undefined,
          documentNumber: data.extractedData.documentNumber || undefined,
          dateOfBirth: data.extractedData.dateOfBirth || undefined,
          expirationDate: data.extractedData.expirationDate || undefined,
          nationality: data.extractedData.nationality || undefined,
          gender: data.extractedData.gender || undefined,
        }
      : undefined,
    validationIssues: data.validationIssues || [],
  };
}

/**
 * Process a document image using AI vision.
 *
 * Priority order:
 * 1. RapidOCR service (fast, local, ~2-5s)
 * 2. Vercel AI Gateway (cloud fallback)
 *
 * @param imageBase64 - Base64 encoded image (with or without data URL prefix)
 * @returns Document analysis result with type, validation, and extracted data
 */
export async function processDocument(imageBase64: string): Promise<DocumentResult> {
  // Try RapidOCR service first (fastest, privacy-first)
  if (USE_OCR_SERVICE) {
    try {
      return await processDocumentOCR(imageBase64);
    } catch (error) {
      console.error("OCR service failed:", error);
      // Fall through to cloud
    }
  }

  // Cloud fallback
  if (process.env.AI_GATEWAY_API_KEY) {
    return await processDocumentCloud(imageBase64);
  }

  // No processing method available
  return {
    documentType: "unknown",
    isValidDRDocument: false,
    confidence: 0,
    validationIssues: ["no_ocr_service_available"],
  };
}

/**
 * Check if OCR service is available
 */
export async function checkOCRServiceHealth(): Promise<{
  available: boolean;
  service?: string;
  version?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`${getBaseUrl()}/api/ocr/health`);
    if (!response.ok) {
      return { available: false, error: "OCR service not responding" };
    }

    const data = await response.json();
    return {
      available: data.status === "healthy",
      service: data.service,
      version: data.version,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "Failed to connect to OCR service",
    };
  }
}

/**
 * Get a human-readable description of validation issues.
 */
export function getIssueDescription(issue: string): string {
  const issueMap: Record<string, string> = {
    not_dr_document: "This document does not appear to be from the Dominican Republic",
    image_quality_low: "Image quality is too low to read clearly",
    document_expired: "This document appears to be expired",
    no_text_visible: "No readable text was found on the document",
    no_text_detected: "No readable text was detected on the document",
    partial_data: "Some fields could not be extracted from the document",
    suspicious_format: "Document format does not match expected DR document layout",
    ocr_failed: "OCR processing failed",
    no_ocr_service_available: "No OCR service available - please start the OCR service",
    ocr_service_unavailable: "OCR service is temporarily unavailable",
    missing_document_number: "Document number could not be extracted",
    invalid_cedula_length: "Cedula number has incorrect length",
    invalid_cedula_characters: "Cedula number contains invalid characters",
    invalid_passport_format: "Passport number format is invalid",
    invalid_expiration_format: "Expiration date format is invalid",
    invalid_dob_format: "Date of birth format is invalid",
    invalid_date_of_birth: "Date of birth appears to be invalid",
    minor_age_detected: "Document holder appears to be a minor",
  };

  return issueMap[issue] || issue;
}
