import "server-only";

import type { OcrProcessResult } from "./ocr-client";

import { v4 as uuidv4 } from "uuid";

import {
  computeClaimHash,
  getDocumentHashField,
} from "@/lib/blockchain/attestation/claim-hash";
import { documentHashExists } from "@/lib/db/queries/identity";
import { logger } from "@/lib/logging/logger";
import { toNumericCode } from "@/lib/privacy/country";

import { dobToDaysSince1900 } from "../verification/birth-year";
import { processDocumentOcr } from "./ocr-client";

/** Matches a string containing only digits */
const DIGITS_ONLY_PATTERN = /^\d+$/;

/**
 * Parsed date values from OCR result.
 * Uses `dobDays` (days since 1900-01-01) for full date precision.
 */
interface ParsedDateValues {
  /** Days since 1900-01-01 for date of birth */
  dobDays: number | null;
  /** YYYYMMDD integer for expiration date */
  expiryDateInt: number | null;
  /** ISO 3166-1 alpha-3 country code */
  nationalityCode: string | null;
  /** Numeric nationality code for ZK circuits */
  nationalityCodeNumeric: number | null;
}

/**
 * Computed claim hashes for attestation.
 */
export interface ComputedClaimHashes {
  ageClaimHash: string | null;
  docValidityClaimHash: string | null;
  nationalityClaimHash: string | null;
}

/**
 * Document processing result from shared OCR + validation logic.
 */
export interface DocumentProcessingResult {
  ocrResult: OcrProcessResult | null;
  draftId: string;
  documentId: string;
  documentProcessed: boolean;
  documentHash: string | null;
  documentHashField: string | null;
  isDuplicateDocument: boolean;
  isDocumentValid: boolean;
  issuerCountry: string | null;
  issues: string[];
  parsedDates: ParsedDateValues;
  claimHashes: ComputedClaimHashes;
}

/**
 * Input parameters for document processing.
 */
export interface ProcessDocumentParams {
  image: string;
  requestId: string;
  flowId?: string;
  existingDraftId?: string | null;
  existingDocumentId?: string | null;
}

/**
 * Parse a date string to YYYYMMDD integer format.
 * Handles formats: MM/DD/YYYY, YYYY-MM-DD, YYYYMMDD
 */
function parseDateToInt(dateValue?: string | null): number | null {
  if (!dateValue) {
    return null;
  }
  if (dateValue.includes("/")) {
    const parts = dateValue.split("/");
    if (parts.length === 3) {
      const month = Number.parseInt(parts[0] ?? "", 10);
      const day = Number.parseInt(parts[1] ?? "", 10);
      const year = Number.parseInt(parts[2] ?? "", 10);
      if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        Number.isFinite(day)
      ) {
        return year * 10_000 + month * 100 + day;
      }
    }
  }
  if (dateValue.includes("-")) {
    const parts = dateValue.split("-");
    if (parts.length === 3) {
      const year = Number.parseInt(parts[0] ?? "", 10);
      const month = Number.parseInt(parts[1] ?? "", 10);
      const day = Number.parseInt(parts[2] ?? "", 10);
      if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        Number.isFinite(day)
      ) {
        return year * 10_000 + month * 100 + day;
      }
    }
  }
  if (dateValue.length === 8 && DIGITS_ONLY_PATTERN.test(dateValue)) {
    const year = Number.parseInt(dateValue.slice(0, 4), 10);
    const month = Number.parseInt(dateValue.slice(4, 6), 10);
    const day = Number.parseInt(dateValue.slice(6, 8), 10);
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day)
    ) {
      return year * 10_000 + month * 100 + day;
    }
  }
  return null;
}

/**
 * Parse date values from OCR extracted data.
 * Standardizes on `dobDays` format for birth date (days since 1900-01-01).
 */
function parseDateValues(
  extractedData: OcrProcessResult["extractedData"]
): ParsedDateValues {
  const dateOfBirth = extractedData?.dateOfBirth ?? null;
  const dobDays = dateOfBirth
    ? (dobToDaysSince1900(dateOfBirth) ?? null)
    : null;
  const expiryDateInt = parseDateToInt(extractedData?.expirationDate);
  const nationalityCode = extractedData?.nationalityCode ?? null;
  const nationalityCodeNumeric = nationalityCode
    ? (toNumericCode(nationalityCode) ?? null)
    : null;

  return {
    dobDays,
    expiryDateInt,
    nationalityCode,
    nationalityCodeNumeric,
  };
}

/**
 * Compute claim hashes for attestation in parallel.
 * Uses `dobDays` for age claim (full date precision).
 */
async function computeClaimHashes(
  documentHashField: string,
  parsedDates: ParsedDateValues,
  issues: string[]
): Promise<ComputedClaimHashes> {
  let ageClaimHash: string | null = null;
  let docValidityClaimHash: string | null = null;
  let nationalityClaimHash: string | null = null;

  const hashTasks: Promise<void>[] = [];

  // Capture non-null values before async callbacks (TypeScript narrowing)
  const { dobDays, expiryDateInt, nationalityCodeNumeric } = parsedDates;

  if (dobDays !== null) {
    const value = dobDays;
    hashTasks.push(
      (async () => {
        try {
          ageClaimHash = await computeClaimHash({
            value,
            documentHashField,
          });
        } catch (error) {
          logger.error(
            { error: String(error), dobDays: value },
            "Failed to compute age claim hash"
          );
          issues.push("age_claim_hash_failed");
        }
      })()
    );
  }

  if (expiryDateInt !== null) {
    const value = expiryDateInt;
    hashTasks.push(
      (async () => {
        try {
          docValidityClaimHash = await computeClaimHash({
            value,
            documentHashField,
          });
        } catch (error) {
          logger.error(
            { error: String(error), expiryDateInt: value },
            "Failed to compute doc validity claim hash"
          );
          issues.push("doc_validity_claim_hash_failed");
        }
      })()
    );
  }

  if (nationalityCodeNumeric !== null) {
    const value = nationalityCodeNumeric;
    hashTasks.push(
      (async () => {
        try {
          nationalityClaimHash = await computeClaimHash({
            value,
            documentHashField,
          });
        } catch (error) {
          logger.error(
            { error: String(error), nationalityCodeNumeric: value },
            "Failed to compute nationality claim hash"
          );
          issues.push("nationality_claim_hash_failed");
        }
      })()
    );
  }

  if (hashTasks.length) {
    await Promise.all(hashTasks);
  }

  return { ageClaimHash, docValidityClaimHash, nationalityClaimHash };
}

/**
 * Process document OCR and compute all derived values.
 *
 * This shared function encapsulates:
 * - OCR service call
 * - Document hash computation and validation
 * - Date parsing (using dobDays format)
 * - Claim hash computation
 * - Document validity determination
 *
 * Callers are responsible for:
 * - Draft lookup (by session ID or user ID)
 * - Database persistence (upsertIdentityDraft, createIdentityDocument)
 * - Session/progress updates
 */
export async function processDocumentWithOcr(
  params: ProcessDocumentParams
): Promise<DocumentProcessingResult> {
  const issues: string[] = [];
  const draftId = params.existingDraftId ?? uuidv4();
  const documentId = params.existingDocumentId ?? uuidv4();

  // Call OCR service
  const ocrResult = await processDocumentOcr({
    image: params.image,
    requestId: params.requestId,
    flowId: params.flowId,
  }).catch((error) => {
    logger.error(
      { error: String(error), requestId: params.requestId },
      "Document OCR processing failed"
    );
    return null;
  });

  // Process OCR result
  if (ocrResult) {
    issues.push(...(ocrResult.validationIssues || []));
  } else {
    issues.push("document_processing_failed");
  }

  const documentProcessed = Boolean(ocrResult?.commitments);
  const documentHash = ocrResult?.commitments?.documentHash ?? null;

  // Compute document hash field
  let documentHashField: string | null = null;
  if (documentHash) {
    try {
      documentHashField = getDocumentHashField(documentHash);
    } catch (error) {
      logger.error(
        { error: String(error), documentHash },
        "Failed to generate document hash field"
      );
      issues.push("document_hash_field_failed");
    }
  }

  // Check for duplicate document
  let isDuplicateDocument = false;
  if (documentHash) {
    const hashExists = await documentHashExists(documentHash);
    if (hashExists) {
      isDuplicateDocument = true;
      issues.push("duplicate_document");
    }
  }

  // Parse date values
  const parsedDates = parseDateValues(ocrResult?.extractedData);

  // Compute claim hashes
  let claimHashes: ComputedClaimHashes = {
    ageClaimHash: null,
    docValidityClaimHash: null,
    nationalityClaimHash: null,
  };
  if (documentHashField) {
    claimHashes = await computeClaimHashes(
      documentHashField,
      parsedDates,
      issues
    );
  }

  // Determine issuer country
  const issuerCountry =
    ocrResult?.documentOrigin ||
    ocrResult?.extractedData?.nationalityCode ||
    null;

  // Determine document validity
  const hasExpiredDocument = Boolean(
    ocrResult?.validationIssues?.includes("document_expired")
  );
  const isDocumentValid =
    documentProcessed &&
    (ocrResult?.confidence ?? 0) > 0.3 &&
    Boolean(ocrResult?.extractedData?.documentNumber) &&
    !isDuplicateDocument &&
    !hasExpiredDocument;

  return {
    ocrResult,
    draftId,
    documentId,
    documentProcessed,
    documentHash,
    documentHashField,
    isDuplicateDocument,
    isDocumentValid,
    issuerCountry,
    issues,
    parsedDates,
    claimHashes,
  };
}
