"use client";

import { useState, useCallback, useEffect } from "react";
import { useWizard } from "../wizard-provider";
import { WizardNavigation } from "../wizard-navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X, FileText, Upload, Loader2, CheckCircle2, AlertCircle, CreditCard } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DOCUMENT_TYPE_LABELS, type DocumentResult } from "@/lib/document-ai";

type ProcessingState = "idle" | "converting" | "processing" | "verified" | "rejected";

export function StepIdUpload() {
  const { state, updateData, nextStep } = useWizard();
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(
    state.data.idDocument?.name || null
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>(
    state.data.documentResult ? "verified" : "idle"
  );

  // Generate preview URL when file is selected
  useEffect(() => {
    if (state.data.idDocument && state.data.idDocument.type.startsWith("image/")) {
      const url = URL.createObjectURL(state.data.idDocument);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    return undefined;
  }, [state.data.idDocument]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      handleFile(file);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const processDocument = async (base64: string): Promise<DocumentResult> => {
    const response = await fetch("/api/kyc/process-document", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64 }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to process document");
    }

    return response.json();
  };

  const handleFile = async (file: File) => {
    setUploadError(null);

    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      const errorMsg = "Please upload an image file (JPEG, PNG, or WebP). PDFs are not supported for AI processing.";
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

    setFileName(file.name);
    updateData({ idDocument: file, documentResult: null });
    setProcessingState("converting");

    try {
      // Convert to base64
      const base64 = await fileToBase64(file);
      updateData({ idDocumentBase64: base64 });
      setProcessingState("processing");

      // Process with AI
      const result = await processDocument(base64);
      updateData({ documentResult: result });

      // Check if document is valid (recognized type with extracted data)
      const isValid = result.documentType !== "unknown" &&
                      result.confidence > 0.3 &&
                      result.extractedData?.documentNumber;

      if (isValid) {
        setProcessingState("verified");
        toast.success("Document verified!", {
          description: `${DOCUMENT_TYPE_LABELS[result.documentType]} detected successfully.`,
        });
        // Store extracted data in wizard state for later use
        if (result.extractedData) {
          updateData({
            extractedName: result.extractedData.fullName || null,
            extractedDOB: result.extractedData.dateOfBirth || null,
            extractedDocNumber: result.extractedData.documentNumber || null,
            extractedNationality: result.extractedData.nationality || null,
            extractedExpirationDate: result.extractedData.expirationDate || null,
          });
        }
      } else {
        setProcessingState("rejected");
        toast.error("Document not accepted", {
          description: result.documentType === "unknown"
            ? "Unable to identify document type. Please try a different document."
            : "Could not extract required information. Please ensure the document is clear and visible.",
        });
      }
    } catch (error) {
      console.error("Document processing error:", error);
      const errorMsg = error instanceof Error ? error.message : "Failed to process document";
      setUploadError(errorMsg);
      toast.error("Processing failed", {
        description: errorMsg,
      });
      setProcessingState("idle");
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
      extractedExpirationDate: null,
    });
  };

  const handleSubmit = () => {
    nextStep();
  };

  const documentResult = state.data.documentResult;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Upload ID Document</h3>
        <p className="text-sm text-muted-foreground">
          Upload a government-issued ID document for verification. We accept passports, national ID cards, and driver's licenses.
        </p>
      </div>

      {uploadError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{uploadError}</AlertDescription>
        </Alert>
      )}

      {/* Processing indicator with skeleton */}
      {(processingState === "converting" || processingState === "processing") && (
        <div className="space-y-4 animate-in fade-in duration-300">
          {/* Status header */}
          <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
            <div>
              <p className="font-medium text-blue-700 dark:text-blue-300">
                {processingState === "converting" ? "Preparing document..." : "Analyzing document..."}
              </p>
              <p className="text-sm text-blue-600 dark:text-blue-400">
                {processingState === "processing" && "AI is verifying your document"}
              </p>
            </div>
          </div>

          {/* Document preview skeleton */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <Skeleton className="mx-auto h-48 w-full max-w-xs rounded-lg" />
          </div>

          {/* Extracted data skeleton */}
          <div className="rounded-lg border bg-card p-4 space-y-4">
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
          <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-green-700 dark:text-green-300">Document Verified</p>
              <p className="text-sm text-green-600 dark:text-green-400">
                {DOCUMENT_TYPE_LABELS[documentResult.documentType]} detected
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8"
              onClick={handleRemove}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Remove file</span>
            </Button>
          </div>

          {/* Preview */}
          {previewUrl && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <img
                src={previewUrl}
                alt="ID preview"
                className="mx-auto max-h-48 rounded-lg object-contain"
              />
            </div>
          )}

          {/* Extracted data */}
          {documentResult.extractedData && (
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <h4 className="font-medium">Extracted Information</h4>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {documentResult.extractedData.fullName && (
                  <>
                    <dt className="text-muted-foreground">Full Name</dt>
                    <dd className="font-medium">{documentResult.extractedData.fullName}</dd>
                  </>
                )}
                {documentResult.extractedData.documentNumber && (
                  <>
                    <dt className="text-muted-foreground">Document Number</dt>
                    <dd className="font-medium">{documentResult.extractedData.documentNumber}</dd>
                  </>
                )}
                {documentResult.extractedData.dateOfBirth && (
                  <>
                    <dt className="text-muted-foreground">Date of Birth</dt>
                    <dd className="font-medium">{documentResult.extractedData.dateOfBirth}</dd>
                  </>
                )}
                {documentResult.extractedData.expirationDate && (
                  <>
                    <dt className="text-muted-foreground">Expiration Date</dt>
                    <dd className="font-medium">{documentResult.extractedData.expirationDate}</dd>
                  </>
                )}
                {documentResult.extractedData.nationality && (
                  <>
                    <dt className="text-muted-foreground">Nationality</dt>
                    <dd className="font-medium">{documentResult.extractedData.nationality}</dd>
                  </>
                )}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Confidence: {Math.round(documentResult.confidence * 100)}%
              </p>
            </div>
          )}
        </div>
      )}

      {/* Rejected document display */}
      {processingState === "rejected" && documentResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <div className="flex-1">
              <p className="font-medium text-red-700 dark:text-red-300">Document Not Accepted</p>
              <p className="text-sm text-red-600 dark:text-red-400">
                {documentResult.documentType === "unknown"
                  ? "Unable to identify document type"
                  : "Could not extract required information from document"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleRemove}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Remove file</span>
            </Button>
          </div>

          {documentResult.validationIssues.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <h4 className="mb-2 text-sm font-medium">Issues Found:</h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {documentResult.validationIssues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          {previewUrl && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <img
                src={previewUrl}
                alt="ID preview"
                className="mx-auto max-h-32 rounded-lg object-contain opacity-50"
              />
            </div>
          )}

          <Button variant="outline" onClick={handleRemove} className="w-full">
            Try a Different Document
          </Button>
        </div>
      )}

      {/* PDF preview (not supported for AI) */}
      {fileName && !previewUrl && processingState === "idle" && (
        <div className="relative rounded-lg border bg-muted/30 p-4">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-8 w-8"
            onClick={handleRemove}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Remove file</span>
          </Button>
          <div className="flex flex-col items-center gap-3 py-4">
            <FileText className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm font-medium">{fileName}</p>
            <p className="text-xs text-muted-foreground">PDF document uploaded</p>
          </div>
        </div>
      )}

      {/* Upload area - only show if no file selected or rejected */}
      {!fileName && processingState === "idle" && (
        <div
          className={cn(
            "relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors",
            dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
          )}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => document.getElementById("file-upload")?.click()}
        >
          <input
            id="file-upload"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleChange}
          />
          <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">Drop your ID here or click to browse</p>
          <p className="mt-1 text-sm text-muted-foreground">
            JPEG, PNG, or WebP (max 10MB)
          </p>
        </div>
      )}

      <Alert>
        <AlertDescription>
          Your ID will be analyzed using AI to extract information. The document will be encrypted before storage. We use zero-knowledge proofs to verify your identity without exposing the actual document.
        </AlertDescription>
      </Alert>

      <WizardNavigation
        onNext={handleSubmit}
        showSkip
        disableNext={processingState === "converting" || processingState === "processing"}
      />
    </div>
  );
}
