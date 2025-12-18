/**
 * Document Processing Module - Client-Safe Exports
 *
 * This barrel file only exports modules that are safe for client components.
 * For server-only utilities (image-processing), import directly from
 * the specific module files.
 */

// Document OCR processing (client-safe)
export type { DocumentResult } from "./document-ocr";
// OCR client types (client-safe)
export type { OcrProcessResult } from "./ocr-client";

export {
  DOCUMENT_TYPE_LABELS,
  processDocument,
} from "./document-ocr";
