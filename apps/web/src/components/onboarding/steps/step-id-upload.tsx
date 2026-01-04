/**
 * Step 2: ID Document Upload
 *
 * Handles document image upload and OCR processing:
 * - Accepts JPEG, PNG, WebP images (max 10MB)
 * - Resizes/compresses before upload to speed up OCR
 * - Sends to OCR service via tRPC for MRZ/visual zone extraction
 * - Displays extracted data for user verification
 * - Provides error recovery suggestions for common issues
 *
 * Processing flow:
 * 1. User uploads/drops image
 * 2. Image resized to max 1800px
 * 3. OCR extracts document data
 * 4. Display verification status with extracted fields
 */
"use client";

/* eslint @next/next/no-img-element: off */

import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  FileText,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DOCUMENT_TYPE_LABELS,
  type DocumentResult,
} from "@/lib/document/document-ocr";
import { trpc } from "@/lib/trpc/client";
import { resizeImageFile } from "@/lib/utils/image";
import { cn } from "@/lib/utils/utils";

import { WizardNavigation } from "../wizard-navigation";
import { useWizard } from "../wizard-provider";

type ProcessingState =
  | "idle"
  | "converting"
  | "processing"
  | "verified"
  | "rejected";

/** Timeout for OCR processing before showing error (45 seconds). */
const PROCESSING_TIMEOUT = 45_000;

/** User-friendly recovery suggestions keyed by validation issue. */
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

export function StepIdUpload() {
  const { state, updateData, nextStep, updateServerProgress, reset } =
    useWizard();
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(
    state.data.idDocument?.name || null
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>(
    state.data.documentResult ? "verified" : "idle"
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Generate preview URL when file is selected
  useEffect(() => {
    if (state.data.idDocument?.type.startsWith("image/")) {
      const url = URL.createObjectURL(state.data.idDocument);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    return;
  }, [state.data.idDocument]);

  // Timeout for long-running document processing
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
    }, PROCESSING_TIMEOUT);

    return () => clearTimeout(timeout);
  }, [processingState]);

  const processDocument = useCallback(
    (base64: string) => trpc.identity.prepareDocument.mutate({ image: base64 }),
    []
  );

  const handleFile = useCallback(
    async (file: File) => {
      setUploadError(null);

      const validTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!validTypes.includes(file.type)) {
        const errorMsg =
          "Please upload an image file (JPEG, PNG, or WebP). PDFs are not supported for document processing.";
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
        // Resize + compress before upload to speed up OCR processing
        const { file: resizedFile, dataUrl } = await resizeImageFile(file, {
          maxWidth: 1800,
          maxHeight: 1800,
          quality: 0.82,
        });

        setFileName(resizedFile.name);
        updateData({ idDocument: resizedFile, documentResult: null });
        setProcessingState("converting");

        updateData({ idDocumentBase64: dataUrl });
        setProcessingState("processing");

        // Process with OCR + draft creation
        const response = await processDocument(dataUrl);
        const result = response.documentResult as DocumentResult;
        updateData({
          documentResult: result,
          identityDraftId: response.draftId,
          identityDocumentId: response.documentId ?? null,
        });

        const hasExpiredDocument =
          result.validationIssues.includes("document_expired");
        if (response.isDuplicateDocument) {
          setProcessingState("rejected");
          const errorMsg =
            "This document appears to be already in use. Please contact support if you believe this is a mistake.";
          setUploadError(errorMsg);
          toast.error("Duplicate document detected", {
            description: errorMsg,
          });
          await updateServerProgress({
            documentProcessed: false,
            step: 2,
            identityDraftId: response.draftId,
          });
          return;
        }
        if (hasExpiredDocument) {
          setProcessingState("rejected");
          setUploadError(ERROR_RECOVERY_TIPS.document_expired);
          toast.error("Document expired", {
            description: ERROR_RECOVERY_TIPS.document_expired,
          });
          await updateServerProgress({
            documentProcessed: false,
            step: 2,
            identityDraftId: response.draftId,
          });
          return;
        }

        // Check if document is valid (recognized type with extracted data)
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
          // Mark document as processed on server (required for step validation)
          await updateServerProgress({
            documentProcessed: true,
            step: 2,
            identityDraftId: response.draftId,
          });
          // Store extracted data in wizard state for later use
          if (result.extractedData) {
            updateData({
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

        // Check if this is a session error (FORBIDDEN = session expired)
        if (
          errorMsg.includes("onboarding session") ||
          errorMsg.includes("start from the beginning")
        ) {
          toast.info("Session expired. Starting fresh...");
          setProcessingState("idle");
          reset();
          return;
        }

        setUploadError(errorMsg);
        toast.error("Processing failed", {
          description: errorMsg,
        });
        setProcessingState("idle");
      }
    },
    [updateData, processDocument, updateServerProgress, reset]
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files?.[0]) {
        const file = e.dataTransfer.files[0];
        handleFile(file).catch(() => {
          // Error handled via setOcrError() internally
        });
      }
    },
    [handleFile]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      handleFile(e.target.files[0]).catch(() => {
        // Error handled via setOcrError() internally
      });
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFileName(null);
    setPreviewUrl(null);
    setProcessingState("idle");
    updateData({
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
  };

  const documentResult = state.data.documentResult;
  const isVerified = processingState === "verified" && Boolean(documentResult);

  const handleSubmit = () => {
    if (!isVerified) {
      const errorMsg = "Please upload a clear photo of your ID to continue.";
      setUploadError(errorMsg);
      toast.error("ID required", { description: errorMsg });
      return;
    }
    nextStep();
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="font-medium text-lg">Upload ID Document</h3>
        <p className="text-muted-foreground text-sm">
          Upload a government-issued ID document for verification. We accept
          passports, national ID cards, and driver&apos;s licenses.
        </p>
      </div>

      {uploadError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{uploadError}</AlertDescription>
        </Alert>
      ) : null}

      {/* Processing indicator with skeleton */}
      {(processingState === "converting" ||
        processingState === "processing") && (
        <div className="fade-in animate-in space-y-4 duration-300">
          {/* Status header */}
          <div className="flex items-center gap-3 rounded-lg border border-info/30 bg-info/10 p-4 text-info">
            <Loader2 className="h-5 w-5 animate-spin" />
            <div>
              <p className="font-medium">
                {processingState === "converting"
                  ? "Preparing document..."
                  : "Analyzing document..."}
              </p>
              <p className="text-info/80 text-sm">
                {processingState === "processing" &&
                  "Verifying your document securely"}
              </p>
            </div>
          </div>

          {/* Document preview skeleton */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <Skeleton className="mx-auto h-48 w-full max-w-xs rounded-lg" />
          </div>

          {/* Extracted data skeleton */}
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </div>
      )}

      {/* Verified document display */}
      {processingState === "verified" && documentResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/10 p-4 text-success">
            <CheckCircle2 className="h-5 w-5" />
            <div>
              <p className="font-medium">Document Verified</p>
              <p className="text-sm text-success/80">
                {DOCUMENT_TYPE_LABELS[documentResult.documentType]} detected
              </p>
            </div>
            <Button
              className="ml-auto h-8 w-8"
              onClick={handleRemove}
              size="icon"
              variant="ghost"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Remove file</span>
            </Button>
          </div>

          {/* Preview */}
          {previewUrl ? (
            <div className="rounded-lg border bg-muted/30 p-4">
              <img
                alt="ID preview"
                className="mx-auto max-h-48 rounded-lg object-contain"
                height={192}
                src={previewUrl}
                width={288}
              />
            </div>
          ) : null}

          {/* Extracted data */}
          {documentResult.extractedData ? (
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <h4 className="font-medium">Extracted Information</h4>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {documentResult.extractedData.fullName ? (
                  <>
                    <dt className="text-muted-foreground">Full Name</dt>
                    <dd className="font-medium">
                      {documentResult.extractedData.fullName}
                    </dd>
                  </>
                ) : null}
                {documentResult.extractedData.documentNumber ? (
                  <>
                    <dt className="text-muted-foreground">Document Number</dt>
                    <dd className="font-medium">
                      {documentResult.extractedData.documentNumber}
                    </dd>
                  </>
                ) : null}
                {documentResult.extractedData.dateOfBirth ? (
                  <>
                    <dt className="text-muted-foreground">Date of Birth</dt>
                    <dd className="font-medium">
                      {documentResult.extractedData.dateOfBirth}
                    </dd>
                  </>
                ) : null}
                {documentResult.extractedData.expirationDate ? (
                  <>
                    <dt className="text-muted-foreground">Expiration Date</dt>
                    <dd className="font-medium">
                      {documentResult.extractedData.expirationDate}
                    </dd>
                  </>
                ) : null}
                {documentResult.extractedData.nationality ? (
                  <>
                    <dt className="text-muted-foreground">Nationality</dt>
                    <dd className="font-medium">
                      {documentResult.extractedData.nationality}
                    </dd>
                  </>
                ) : null}
              </dl>
              <p className="mt-3 text-muted-foreground text-xs">
                Confidence: {Math.round(documentResult.confidence * 100)}%
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* Rejected document display */}
      {processingState === "rejected" && documentResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <div className="flex-1">
              <p className="font-medium">Document Not Accepted</p>
              <p className="text-destructive/80 text-sm">
                {documentResult.documentType === "unknown"
                  ? "Unable to identify document type"
                  : "Could not extract required information from document"}
              </p>
            </div>
            <Button
              className="h-8 w-8"
              onClick={handleRemove}
              size="icon"
              variant="ghost"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Remove file</span>
            </Button>
          </div>

          {documentResult.validationIssues.length > 0 && (
            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <div>
                <h4 className="mb-2 font-medium text-sm">Issues Found:</h4>
                <ul className="list-inside list-disc space-y-1 text-muted-foreground text-sm">
                  {documentResult.validationIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>

              {/* Error recovery suggestions */}
              <div className="border-t pt-3">
                <h4 className="mb-2 font-medium text-primary text-sm">
                  How to fix:
                </h4>
                <ul className="space-y-2 text-muted-foreground text-sm">
                  {documentResult.validationIssues.map((issue) => {
                    // Convert issue to key format (e.g., "Document is blurry" -> "document_blurry")
                    const issueKey = issue
                      .toLowerCase()
                      .replace(/\s+/g, "_")
                      .replace(/[^a-z_]/g, "");
                    const tip =
                      ERROR_RECOVERY_TIPS[issueKey] ||
                      ERROR_RECOVERY_TIPS[issueKey.split("_")[0]] ||
                      "Ensure your document is clear, well-lit, and fully visible.";
                    return (
                      <li
                        className="flex items-start gap-2"
                        key={`tip-${issue}`}
                      >
                        <span className="mt-0.5 text-primary">•</span>
                        <span>{tip}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {previewUrl ? (
            <div className="rounded-lg border bg-muted/30 p-4">
              <img
                alt="ID preview"
                className="mx-auto max-h-32 rounded-lg object-contain opacity-50"
                height={128}
                src={previewUrl}
                width={192}
              />
            </div>
          ) : null}

          <Button className="w-full" onClick={handleRemove} variant="outline">
            Try a Different Document
          </Button>
        </div>
      )}

      {/* PDF preview (not supported for AI) */}
      {fileName && !previewUrl && processingState === "idle" && (
        <div className="relative rounded-lg border bg-muted/30 p-4">
          <Button
            className="absolute top-2 right-2 h-8 w-8"
            onClick={handleRemove}
            size="icon"
            variant="ghost"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Remove file</span>
          </Button>
          <div className="flex flex-col items-center gap-3 py-4">
            <FileText className="h-12 w-12 text-muted-foreground" />
            <p className="font-medium text-sm">{fileName}</p>
            <p className="text-muted-foreground text-xs">
              PDF document uploaded
            </p>
          </div>
        </div>
      )}

      {/* Upload area - only show if no file selected or rejected */}
      {!fileName && processingState === "idle" && (
        <Button
          aria-describedby="id-upload-help"
          className={cn(
            "relative flex min-h-[200px] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors",
            dragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25"
          )}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          type="button"
          variant="outline"
        >
          <input
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            id="file-upload"
            onChange={handleChange}
            ref={fileInputRef}
            type="file"
          />
          <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">Drop your ID here or click to browse</p>
          <p className="mt-1 text-muted-foreground text-sm" id="id-upload-help">
            JPEG, PNG, or WebP (max 10MB)
          </p>
        </Button>
      )}

      <Alert>
        <AlertDescription>
          Your ID is processed by our private OCR service to extract the fields
          needed for verification. It is not sent to third-party processors. We
          use cryptographic proofs and encryption to reduce the amount of raw
          data we store.
        </AlertDescription>
      </Alert>

      <WizardNavigation disableNext={!isVerified} onNext={handleSubmit} />
    </div>
  );
}
