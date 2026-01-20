"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  DOCUMENT_TYPE_LABELS,
  type DocumentResult,
} from "@/lib/identity/document/document-ocr";
import { trpc } from "@/lib/trpc/client";
import { resizeImageFile } from "@/lib/utils/image";
import { useVerificationStore } from "@/store/verification";

export type ProcessingState =
  | "idle"
  | "converting"
  | "processing"
  | "verified"
  | "rejected";

const PROCESSING_TIMEOUT_MS = 45_000;

const ERROR_RECOVERY_TIPS: Record<string, string> = {
  document_blurry:
    "Hold your camera steady and ensure the document is in focus before capturing.",
  poor_lighting:
    "Move to a well-lit area. Natural light works best. Avoid shadows on the document.",
  text_not_readable:
    "Make sure all text on the document is clearly visible and not cut off.",
  face_not_visible:
    "Ensure the photo on your ID is clearly visible and not obscured.",
  document_expired:
    "This document appears to be expired. Please use a valid, non-expired document.",
  glare_detected:
    "Reduce glare by tilting the document slightly or moving away from direct light.",
  partial_document:
    "Make sure the entire document is visible in the frame, including all edges.",
  unknown_format:
    "Try using a passport, national ID card, or driver's license.",
};

interface UseDocumentProcessingOptions {
  resetOnMount?: boolean;
}

interface UseDocumentProcessingReturn {
  processingState: ProcessingState;
  fileName: string | null;
  previewUrl: string | null;
  uploadError: string | null;
  documentResult: DocumentResult | null;
  isVerified: boolean;
  handleFile: (file: File) => Promise<void>;
  handleRemove: () => void;
  resetState: () => void;
}

export function useDocumentProcessing(
  options: UseDocumentProcessingOptions = {}
): UseDocumentProcessingReturn {
  const { resetOnMount = false } = options;

  // Select specific state to avoid re-renders on unrelated store changes
  const idDocument = useVerificationStore((s) => s.idDocument);
  const documentResult = useVerificationStore((s) => s.documentResult);
  const storeReset = useVerificationStore((s) => s.reset);
  const storeSet = useVerificationStore((s) => s.set);

  const hasResetRef = useRef(false);

  const [processingState, setProcessingState] =
    useState<ProcessingState>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Reset store for proof regeneration (Tier 2 → Tier 3 re-verification)
  useEffect(() => {
    if (resetOnMount && !hasResetRef.current) {
      hasResetRef.current = true;
      storeReset();
    }
  }, [resetOnMount, storeReset]);

  // Initialize state from store on mount
  // This effect syncs local state with Zustand store on initial render
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    // Only run once on mount (after potential reset)
    if (hasInitializedRef.current) {
      return;
    }
    if (resetOnMount && !hasResetRef.current) {
      // Wait for reset to complete first
      return;
    }

    hasInitializedRef.current = true;

    // If we have an idDocument but no documentResult, clear the stale file.
    // This happens when navigating away mid-flow - File object stays in memory
    // but documentResult (not persisted) is lost.
    if (idDocument && !documentResult) {
      storeSet({ idDocument: null, idDocumentBase64: null });
      return;
    }

    if (idDocument?.name) {
      setFileName(idDocument.name);
    }
    if (documentResult) {
      setProcessingState("verified");
    }
  }, [idDocument, documentResult, storeSet, resetOnMount]);

  // Generate preview URL when file is selected
  useEffect(() => {
    if (idDocument?.type.startsWith("image/")) {
      const url = URL.createObjectURL(idDocument);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [idDocument]);

  // Timeout for long-running processing
  useEffect(() => {
    if (processingState !== "converting" && processingState !== "processing") {
      return;
    }

    const timeout = setTimeout(() => {
      setUploadError(
        "Processing is taking longer than expected. Please try again with a clearer image."
      );
      setProcessingState("idle");
      toast.error("Processing timeout", {
        description:
          "The document took too long to process. Please try uploading again.",
      });
    }, PROCESSING_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [processingState]);

  const processDocument = useCallback(
    (base64: string) => trpc.identity.prepareDocument.mutate({ image: base64 }),
    []
  );

  const clearExtractedData = useCallback(() => {
    storeSet({
      userSalt: null,
      extractedName: null,
      extractedDOB: null,
      extractedDocNumber: null,
      extractedNationality: null,
      extractedNationalityCode: null,
      extractedExpirationDate: null,
    });
  }, [storeSet]);

  const handleFile = useCallback(
    async (file: File) => {
      setUploadError(null);

      const validTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!validTypes.includes(file.type)) {
        const errorMsg =
          "Please upload an image file (JPEG, PNG, or WebP). PDFs are not supported.";
        setUploadError(errorMsg);
        toast.error("Invalid file type", {
          description: "Please upload a JPEG, PNG, or WebP image.",
        });
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        const errorMsg = "File size must be less than 10MB.";
        setUploadError(errorMsg);
        toast.error("File too large", {
          description: "Please upload a file smaller than 10MB.",
        });
        return;
      }

      try {
        const { file: resizedFile, dataUrl } = await resizeImageFile(file, {
          maxWidth: 1800,
          maxHeight: 1800,
          quality: 0.82,
        });

        setFileName(resizedFile.name);
        storeSet({ idDocument: resizedFile, documentResult: null });
        setProcessingState("converting");

        storeSet({ idDocumentBase64: dataUrl });
        setProcessingState("processing");

        const response = await processDocument(dataUrl);
        const result = response.documentResult as DocumentResult;
        storeSet({
          documentResult: result,
          draftId: response.draftId,
          documentId: response.documentId ?? null,
        });

        const hasExpiredDocument =
          result.validationIssues.includes("document_expired");

        if (response.isDuplicateDocument) {
          setProcessingState("rejected");
          const errorMsg =
            "This document appears to be already in use. Please contact support if you believe this is a mistake.";
          setUploadError(errorMsg);
          toast.error("Duplicate document detected", { description: errorMsg });
          clearExtractedData();
          return;
        }

        if (hasExpiredDocument) {
          setProcessingState("rejected");
          setUploadError(ERROR_RECOVERY_TIPS.document_expired);
          toast.error("Document expired", {
            description: ERROR_RECOVERY_TIPS.document_expired,
          });
          clearExtractedData();
          return;
        }

        const isValid =
          response.isDocumentValid ??
          (result.documentType !== "unknown" &&
            result.confidence > 0.3 &&
            result.extractedData?.documentNumber);

        if (isValid) {
          setProcessingState("verified");
          toast.success("Document verified!", {
            description: `${DOCUMENT_TYPE_LABELS[result.documentType]} detected successfully.`,
          });

          if (result.extractedData) {
            storeSet({
              extractedName: result.extractedData.fullName || null,
              extractedDOB: result.extractedData.dateOfBirth || null,
              extractedDocNumber: result.extractedData.documentNumber || null,
              extractedNationality: result.extractedData.nationality || null,
              extractedNationalityCode:
                result.extractedData.nationalityCode || null,
              extractedExpirationDate:
                result.extractedData.expirationDate || null,
              userSalt: response.userSalt ?? null,
            });
          }
        } else {
          setProcessingState("rejected");
          clearExtractedData();
          toast.error("Document not accepted", {
            description:
              result.documentType === "unknown"
                ? "Unable to identify document type. Please try a different document."
                : "Could not extract required information. Please ensure the document is clear and visible.",
          });
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Failed to process document";
        setUploadError(errorMsg);
        toast.error("Processing failed", { description: errorMsg });
        setProcessingState("idle");
      }
    },
    [processDocument, storeSet, clearExtractedData]
  );

  const handleRemove = useCallback(() => {
    setFileName(null);
    setPreviewUrl(null);
    setProcessingState("idle");
    setUploadError(null);
    storeSet({
      idDocument: null,
      idDocumentBase64: null,
      documentResult: null,
      extractedName: null,
      extractedDOB: null,
      extractedDocNumber: null,
      extractedNationality: null,
      extractedNationalityCode: null,
      extractedExpirationDate: null,
      userSalt: null,
    });
  }, [storeSet]);

  const resetState = useCallback(() => {
    handleRemove();
    storeReset();
  }, [handleRemove, storeReset]);

  const isVerified = processingState === "verified" && Boolean(documentResult);

  return {
    processingState,
    fileName,
    previewUrl,
    uploadError,
    documentResult,
    isVerified,
    handleFile,
    handleRemove,
    resetState,
  };
}
