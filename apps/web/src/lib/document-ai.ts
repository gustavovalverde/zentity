/**
 * Document AI processing with local-first approach.
 *
 * Priority order:
 * 1. RapidOCR service (fast, local, privacy-first)
 * 2. Vercel AI Gateway (cloud fallback)
 *
 * Supports:
 * - Document type detection (passport, national ID, driver's license)
 * - International document validation
 * - Field extraction (name, document number, DOB, etc.)
 */

import { gateway, generateObject } from "ai";
import { z } from "zod";

// Schema for extracted document data
const DocumentSchema = z.object({
  documentType: z.enum([
    "passport",
    "national_id",
    "drivers_license",
    "unknown",
  ]),
  documentOrigin: z.string().optional(), // ISO 3166-1 alpha-3 country code
  confidence: z.number().min(0).max(1),
  extractedData: z
    .object({
      fullName: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      documentNumber: z.string().optional(),
      dateOfBirth: z.string().optional(),
      expirationDate: z.string().optional(),
      nationality: z.string().optional(),
      nationalityCode: z.string().optional(),
      gender: z.string().optional(),
    })
    .optional(),
  validationIssues: z.array(z.string()),
});

export type DocumentResult = z.infer<typeof DocumentSchema>;

// Document types for display
export const DOCUMENT_TYPE_LABELS: Record<
  DocumentResult["documentType"],
  string
> = {
  passport: "Passport",
  national_id: "National ID Card",
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
async function processDocumentCloud(
  imageBase64: string,
): Promise<DocumentResult> {
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

1. Identify the document type: passport, national_id (cedula, DNI, ID card), or drivers_license
2. Identify the issuing country if visible (set documentOrigin to ISO 3166-1 alpha-3 code)
3. Extract key fields if visible:
   - Full name
   - Document number
   - Date of birth (format: YYYY-MM-DD)
   - Expiration date (format: YYYY-MM-DD)
   - Nationality (full country name)
   - Nationality code (ISO 3166-1 alpha-3)
   - Gender (M or F)

Rules:
- If any fields are unclear, blurry, or not visible, omit them from extractedData
- List any validation concerns in validationIssues (e.g., "document_expired", "image_quality_low", "mrz_checksum_invalid")
- Set confidence based on how clearly you can read and verify the document (0.0-1.0)
- For passports, try to read the MRZ (Machine Readable Zone) at the bottom`,
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
async function processDocumentOCR(
  imageBase64: string,
): Promise<DocumentResult> {
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
    documentOrigin: data.documentOrigin || undefined,
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
          nationalityCode: data.extractedData.nationalityCode || undefined,
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
export async function processDocument(
  imageBase64: string,
): Promise<DocumentResult> {
  // Try RapidOCR service first (fastest, privacy-first)
  if (USE_OCR_SERVICE) {
    try {
      return await processDocumentOCR(imageBase64);
    } catch (_error) {
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
      error:
        error instanceof Error
          ? error.message
          : "Failed to connect to OCR service",
    };
  }
}

/**
 * Get a human-readable description of validation issues.
 */
export function getIssueDescription(issue: string): string {
  const issueMap: Record<string, string> = {
    image_quality_low: "Image quality is too low to read clearly",
    document_expired: "This document appears to be expired",
    no_text_visible: "No readable text was found on the document",
    no_text_detected: "No readable text was detected on the document",
    partial_data: "Some fields could not be extracted from the document",
    unrecognized_format: "Document format could not be recognized",
    ocr_failed: "OCR processing failed",
    no_ocr_service_available:
      "No OCR service available - please start the OCR service",
    ocr_service_unavailable: "OCR service is temporarily unavailable",
    missing_document_number: "Document number could not be extracted",
    missing_full_name: "Full name could not be extracted",
    extraction_failed: "Failed to extract document fields",
    invalid_cedula_length: "National ID number has incorrect length",
    invalid_cedula_characters: "National ID number contains invalid characters",
    invalid_passport_format: "Passport number format is invalid",
    invalid_expiration_format: "Expiration date format is invalid",
    invalid_dob_format: "Date of birth format is invalid",
    invalid_date_of_birth: "Date of birth appears to be invalid",
    minor_age_detected: "Document holder appears to be a minor",
    mrz_checksum_invalid: "Passport MRZ checksum validation failed",
  };

  return issueMap[issue] || issue;
}
