/**
 * Verification Error Types
 *
 * Custom error classes for identity verification flows.
 * Enables proper error discrimination between expected failures
 * (e.g., face not detected) and unexpected errors (e.g., service crash).
 *
 * Error Hierarchy:
 * - VerificationError (base) - All verification-related errors
 *   - FaceDetectionError - Face detection failures
 *   - DocumentProcessingError - OCR/document failures
 *   - ClaimSigningError - Cryptographic claim failures
 *   - FheEncryptionError - FHE-related failures
 */

import { logger } from "@/lib/logging/logger";

/**
 * Base error for all verification-related failures.
 * Contains an issue code for programmatic handling.
 */
export class VerificationError extends Error {
  readonly issueCode: string;
  readonly isExpected: boolean;

  constructor(
    message: string,
    issueCode: string,
    options?: { isExpected?: boolean; cause?: unknown }
  ) {
    super(message, { cause: options?.cause });
    this.name = "VerificationError";
    this.issueCode = issueCode;
    this.isExpected = options?.isExpected ?? false;
  }
}

/**
 * Face detection and matching errors.
 */
export class FaceDetectionError extends VerificationError {
  constructor(
    message: string,
    issueCode: string,
    options?: { isExpected?: boolean; cause?: unknown }
  ) {
    super(message, issueCode, options);
    this.name = "FaceDetectionError";
  }

  static noSelfieFace(): FaceDetectionError {
    return new FaceDetectionError(
      "No face detected in selfie image",
      "no_selfie_face",
      { isExpected: true }
    );
  }

  static noDocumentFace(): FaceDetectionError {
    return new FaceDetectionError(
      "No face detected in document image",
      "no_document_face",
      { isExpected: true }
    );
  }

  static embeddingFailed(cause?: unknown): FaceDetectionError {
    return new FaceDetectionError(
      "Failed to compute face embeddings",
      "embedding_failed",
      { isExpected: false, cause }
    );
  }

  static serviceFailed(cause?: unknown): FaceDetectionError {
    return new FaceDetectionError(
      "Face detection service failed",
      "verification_service_failed",
      { isExpected: false, cause }
    );
  }

  static cropFailed(cause?: unknown): FaceDetectionError {
    return new FaceDetectionError(
      "Failed to crop face region from document",
      "face_crop_failed",
      { isExpected: true, cause } // Expected - fallback to uncropped detection
    );
  }
}

/**
 * Document OCR and processing errors.
 */
export class DocumentProcessingError extends VerificationError {
  constructor(
    message: string,
    issueCode: string,
    options?: { isExpected?: boolean; cause?: unknown }
  ) {
    super(message, issueCode, options);
    this.name = "DocumentProcessingError";
  }

  static ocrFailed(cause?: unknown): DocumentProcessingError {
    return new DocumentProcessingError(
      "Document OCR processing failed",
      "document_processing_failed",
      { isExpected: false, cause }
    );
  }

  static duplicateDocument(): DocumentProcessingError {
    return new DocumentProcessingError(
      "Document has already been used for verification",
      "duplicate_document",
      { isExpected: true }
    );
  }

  static hashFieldFailed(cause?: unknown): DocumentProcessingError {
    return new DocumentProcessingError(
      "Failed to generate document hash field",
      "document_hash_field_failed",
      { isExpected: false, cause }
    );
  }

  static invalidDocument(reason: string): DocumentProcessingError {
    return new DocumentProcessingError(
      `Document validation failed: ${reason}`,
      "document_invalid",
      { isExpected: true }
    );
  }
}

/**
 * Signed claim generation errors.
 */
export class ClaimSigningError extends VerificationError {
  readonly claimType: string;

  constructor(
    message: string,
    claimType: string,
    issueCode: string,
    options?: { isExpected?: boolean; cause?: unknown }
  ) {
    super(message, issueCode, options);
    this.name = "ClaimSigningError";
    this.claimType = claimType;
  }

  static ocrClaimFailed(cause?: unknown): ClaimSigningError {
    return new ClaimSigningError(
      "Failed to sign OCR result claim",
      "ocr_result",
      "signed_ocr_claim_failed",
      { isExpected: false, cause }
    );
  }

  static livenessClaimFailed(cause?: unknown): ClaimSigningError {
    return new ClaimSigningError(
      "Failed to sign liveness score claim",
      "liveness_score",
      "signed_liveness_claim_failed",
      { isExpected: false, cause }
    );
  }

  static faceMatchClaimFailed(cause?: unknown): ClaimSigningError {
    return new ClaimSigningError(
      "Failed to sign face match claim",
      "face_match_score",
      "signed_face_match_claim_failed",
      { isExpected: false, cause }
    );
  }

  static claimHashFailed(
    hashType: "age" | "doc_validity" | "nationality",
    cause?: unknown
  ): ClaimSigningError {
    return new ClaimSigningError(
      `Failed to compute ${hashType} claim hash`,
      hashType,
      `${hashType}_claim_hash_failed`,
      { isExpected: false, cause }
    );
  }
}

/**
 * FHE encryption errors.
 */
export class FheEncryptionError extends VerificationError {
  constructor(
    message: string,
    issueCode: string,
    options?: { isExpected?: boolean; cause?: unknown }
  ) {
    super(message, issueCode, options);
    this.name = "FheEncryptionError";
  }

  static keyMissing(): FheEncryptionError {
    return new FheEncryptionError(
      "FHE key material not provided",
      "fhe_key_missing",
      { isExpected: true }
    );
  }

  static encryptionFailed(field: string, cause?: unknown): FheEncryptionError {
    return new FheEncryptionError(
      `FHE encryption failed for ${field}`,
      `fhe_${field}_encryption_failed`,
      { isExpected: false, cause }
    );
  }
}

/**
 * Log verification error with appropriate level based on whether it's expected.
 * Expected errors (e.g., no face detected) are logged as warnings.
 * Unexpected errors (e.g., service crash) are logged as errors.
 */
export function logVerificationError(
  error: VerificationError,
  context?: Record<string, unknown>
): void {
  const logData = {
    errorType: error.name,
    issueCode: error.issueCode,
    isExpected: error.isExpected,
    ...context,
    ...(error.cause ? { cause: String(error.cause) } : {}),
  };

  if (error.isExpected) {
    logger.warn(logData, error.message);
  } else {
    logger.error(logData, error.message);
  }
}

/**
 * Convert any error to a verification issue code.
 * Use this when catching errors to extract issue codes for the issues array.
 */
export function toIssueCode(error: unknown): string {
  if (error instanceof VerificationError) {
    return error.issueCode;
  }
  if (error instanceof Error) {
    return "unexpected_error";
  }
  return "unknown_error";
}

/**
 * Safely execute an operation and convert errors to issue codes.
 * Returns { success: true, value } or { success: false, issueCode }.
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<
  { success: true; value: T } | { success: false; issueCode: string }
> {
  try {
    const value = await operation();
    return { success: true, value };
  } catch (error) {
    if (error instanceof VerificationError) {
      logVerificationError(error, context);
      return { success: false, issueCode: error.issueCode };
    }

    logger.error(
      { error: String(error), ...context },
      "Unexpected error in verification operation"
    );
    return { success: false, issueCode: toIssueCode(error) };
  }
}
