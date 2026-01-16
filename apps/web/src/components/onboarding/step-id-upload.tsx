/**
 * Step 2: ID Document Upload
 *
 * Handles document image upload and OCR processing:
 * - Accepts JPEG, PNG, WebP images (max 10MB)
 * - Resizes/compresses before upload to speed up OCR
 * - Sends to OCR service via tRPC for MRZ/visual zone extraction
 * - Displays extracted data for user verification
 * - Provides error recovery suggestions for common issues
 */
"use client";

/* eslint @next/next/no-img-element: off */

import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  FileText,
  Upload,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  DOCUMENT_TYPE_LABELS,
  type DocumentResult,
} from "@/lib/document/document-ocr";
import { useOnboardingStore } from "@/lib/onboarding/store";
import { trpc } from "@/lib/trpc/client";
import { resizeImageFile } from "@/lib/utils/image";
import { cn } from "@/lib/utils/utils";

import { useStepper } from "./stepper-context";
import { StepperControls } from "./stepper-ui";

type ProcessingState =
  | "idle"
  | "converting"
  | "processing"
  | "verified"
  | "rejected";

const PROCESSING_TIMEOUT = 45_000;

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

/**
 * Verified document display card.
 * Memoized to prevent re-renders when parent state changes (rerender-memo).
 */
const VerifiedDocumentCard = memo(function VerifiedDocumentCard({
  documentResult,
  previewUrl,
  onRemove,
}: {
  documentResult: DocumentResult;
  previewUrl: string | null;
  onRemove: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="space-y-4">
      <Alert className="flex items-center" variant="success">
        <CheckCircle2 className="h-5 w-5" />
        <AlertDescription className="flex-1">
          <p className="font-medium">Document Verified</p>
          <p className="text-sm">
            {DOCUMENT_TYPE_LABELS[documentResult.documentType]} detected
          </p>
        </AlertDescription>
        <Button
          className="ml-auto h-8 w-8"
          onClick={onRemove}
          size="icon"
          variant="ghost"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Remove file</span>
        </Button>
      </Alert>

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
  );
});

export function StepIdUpload() {
  const stepper = useStepper();
  const store = useOnboardingStore();
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(
    store.idDocument?.name || null
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>(
    store.documentResult ? "verified" : "idle"
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Generate preview URL when file is selected
  useEffect(() => {
    if (store.idDocument?.type.startsWith("image/")) {
      const url = URL.createObjectURL(store.idDocument);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    return;
  }, [store.idDocument]);

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
        const { file: resizedFile, dataUrl } = await resizeImageFile(file, {
          maxWidth: 1800,
          maxHeight: 1800,
          quality: 0.82,
        });

        setFileName(resizedFile.name);
        store.set({ idDocument: resizedFile, documentResult: null });
        setProcessingState("converting");

        store.set({ idDocumentBase64: dataUrl });
        setProcessingState("processing");

        const response = await processDocument(dataUrl);
        const result = response.documentResult as DocumentResult;
        store.set({
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
          toast.error("Duplicate document detected", { description: errorMsg });
          store.set({
            documentProcessed: false,
            userSalt: null,
            extractedName: null,
            extractedDOB: null,
            extractedDocNumber: null,
            extractedNationality: null,
            extractedNationalityCode: null,
            extractedExpirationDate: null,
          });
          return;
        }
        if (hasExpiredDocument) {
          setProcessingState("rejected");
          setUploadError(ERROR_RECOVERY_TIPS.document_expired);
          toast.error("Document expired", {
            description: ERROR_RECOVERY_TIPS.document_expired,
          });
          store.set({
            documentProcessed: false,
            userSalt: null,
            extractedName: null,
            extractedDOB: null,
            extractedDocNumber: null,
            extractedNationality: null,
            extractedNationalityCode: null,
            extractedExpirationDate: null,
          });
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
          store.set({ documentProcessed: true });
          if (result.extractedData) {
            store.set({
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
          store.set({
            documentProcessed: false,
            userSalt: null,
            extractedName: null,
            extractedDOB: null,
            extractedDocNumber: null,
            extractedNationality: null,
            extractedNationalityCode: null,
            extractedExpirationDate: null,
          });
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

        if (
          errorMsg.includes("onboarding session") ||
          errorMsg.includes("start from the beginning")
        ) {
          toast.info("Session expired. Starting fresh…");
          setProcessingState("idle");
          store.reset();
          stepper.goTo("email");
          return;
        }

        setUploadError(errorMsg);
        toast.error("Processing failed", { description: errorMsg });
        setProcessingState("idle");
      }
    },
    [processDocument, store, stepper]
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
        // Errors handled internally by handleFile with toast notifications
        handleFile(e.dataTransfer.files[0]).catch(() => undefined);
      }
    },
    [handleFile]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      // Errors handled internally by handleFile with toast notifications
      handleFile(e.target.files[0]).catch(() => undefined);
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFileName(null);
    setPreviewUrl(null);
    setProcessingState("idle");
    store.set({
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

  const documentResult = store.documentResult as DocumentResult | null;
  const isVerified = processingState === "verified" && Boolean(documentResult);

  const handleSubmit = useCallback(() => {
    if (!isVerified) {
      const errorMsg = "Please upload a clear photo of your ID to continue.";
      setUploadError(errorMsg);
      toast.error("ID required", { description: errorMsg });
      return;
    }
    stepper.next();
  }, [isVerified, stepper]);

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

      {/* Processing indicator */}
      {(processingState === "converting" ||
        processingState === "processing") && (
        <div className="fade-in animate-in space-y-4 duration-300">
          <Alert variant="info">
            <Spinner className="size-5" />
            <AlertDescription>
              <p className="font-medium">
                {processingState === "converting"
                  ? "Preparing document…"
                  : "Analyzing document…"}
              </p>
              <p className="text-sm">
                {processingState === "processing" &&
                  "Extracting information from your document"}
              </p>
            </AlertDescription>
          </Alert>

          <div className="rounded-lg border bg-muted/30 p-4">
            <Skeleton className="mx-auto h-48 w-full max-w-xs rounded-lg" />
          </div>

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
            </div>
          </div>
        </div>
      )}

      {/* Verified document - memoized component (rerender-memo) */}
      {processingState === "verified" && documentResult ? (
        <VerifiedDocumentCard
          documentResult={documentResult}
          onRemove={handleRemove}
          previewUrl={previewUrl}
        />
      ) : null}

      {/* Rejected document (rendering-conditional-render: ternary over &&) */}
      {processingState === "rejected" && documentResult ? (
        <div className="space-y-4">
          <Alert className="flex items-center" variant="destructive">
            <AlertCircle className="h-5 w-5" />
            <AlertDescription className="flex-1">
              <p className="font-medium">Document Not Accepted</p>
              <p className="text-sm">
                {documentResult.documentType === "unknown"
                  ? "Unable to identify document type"
                  : "Could not extract required information from document"}
              </p>
            </AlertDescription>
            <Button
              className="h-8 w-8"
              onClick={handleRemove}
              size="icon"
              variant="ghost"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Remove file</span>
            </Button>
          </Alert>

          {documentResult.validationIssues.length > 0 ? (
            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <div>
                <h4 className="mb-2 font-medium text-sm">Issues Found:</h4>
                <ul className="list-inside list-disc space-y-1 text-muted-foreground text-sm">
                  {documentResult.validationIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
              <div className="border-t pt-3">
                <h4 className="mb-2 font-medium text-primary text-sm">
                  How to fix:
                </h4>
                <ul className="space-y-2 text-muted-foreground text-sm">
                  {documentResult.validationIssues.map((issue) => {
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
          ) : null}

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
      ) : null}

      {/* PDF preview (not supported) */}
      {fileName && !previewUrl && processingState === "idle" ? (
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
      ) : null}

      {/* Upload area */}
      {!fileName && processingState === "idle" ? (
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
      ) : null}

      <Alert>
        <AlertDescription>
          Your ID is processed by our private OCR service to extract the fields
          needed for verification. It is not sent to third-party processors. We
          use cryptographic proofs and encryption to reduce the amount of raw
          data we store.
        </AlertDescription>
      </Alert>

      <StepperControls
        disableNext={!isVerified}
        onNext={handleSubmit}
        stepper={stepper}
      />
    </div>
  );
}
