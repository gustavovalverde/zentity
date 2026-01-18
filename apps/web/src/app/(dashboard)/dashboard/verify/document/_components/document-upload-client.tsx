"use client";

import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  FileText,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { memo, useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  type ProcessingState,
  useDocumentProcessing,
} from "@/hooks/verification/use-document-processing";
import {
  DOCUMENT_TYPE_LABELS,
  type DocumentResult,
} from "@/lib/identity/document/document-ocr";
import { cn } from "@/lib/utils/classname";

const VerifiedDocumentCard = memo(function VerifiedDocumentCard({
  documentResult,
  previewUrl,
  onRemove,
}: Readonly<{
  documentResult: DocumentResult;
  previewUrl: string | null;
  onRemove: (e: React.MouseEvent) => void;
}>) {
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
          <Image
            alt="ID preview"
            className="mx-auto max-h-48 rounded-lg object-contain"
            height={192}
            src={previewUrl}
            unoptimized
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

const ProcessingIndicator = memo(function ProcessingIndicator({
  state,
}: Readonly<{ state: ProcessingState }>) {
  return (
    <div className="fade-in animate-in space-y-4 duration-300">
      <Alert variant="info">
        <Spinner className="size-5" />
        <AlertDescription>
          <p className="font-medium">
            {state === "converting"
              ? "Preparing document…"
              : "Analyzing document…"}
          </p>
          <p className="text-sm">
            {state === "processing" &&
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
  );
});

const RejectedDocumentCard = memo(function RejectedDocumentCard({
  documentResult,
  previewUrl,
  onRemove,
}: Readonly<{
  documentResult: DocumentResult;
  previewUrl: string | null;
  onRemove: (e: React.MouseEvent) => void;
}>) {
  return (
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
          <Image
            alt="ID preview"
            className="mx-auto max-h-32 rounded-lg object-contain opacity-50"
            height={128}
            src={previewUrl}
            unoptimized
            width={192}
          />
        </div>
      ) : null}

      <Button className="w-full" onClick={onRemove} variant="outline">
        Try a Different Document
      </Button>
    </div>
  );
});

interface DocumentUploadClientProps {
  resetOnMount?: boolean;
}

export function DocumentUploadClient({
  resetOnMount = false,
}: DocumentUploadClientProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const {
    processingState,
    fileName,
    previewUrl,
    uploadError,
    documentResult,
    isVerified,
    handleFile,
    handleRemove,
  } = useDocumentProcessing({ resetOnMount });

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
        handleFile(e.dataTransfer.files[0]).catch(() => undefined);
      }
    },
    [handleFile]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      handleFile(e.target.files[0]).catch(() => undefined);
    }
  };

  const onRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      handleRemove();
    },
    [handleRemove]
  );

  const handleContinue = useCallback(() => {
    if (!isVerified) {
      toast.error("Please verify your document first");
      return;
    }
    router.push("/dashboard/verify/liveness");
  }, [isVerified, router]);

  const isProcessing =
    processingState === "converting" || processingState === "processing";

  return (
    <div className="space-y-6">
      {uploadError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{uploadError}</AlertDescription>
        </Alert>
      ) : null}

      {isProcessing && <ProcessingIndicator state={processingState} />}

      {processingState === "verified" && documentResult ? (
        <VerifiedDocumentCard
          documentResult={documentResult}
          onRemove={onRemove}
          previewUrl={previewUrl}
        />
      ) : null}

      {processingState === "rejected" && documentResult ? (
        <RejectedDocumentCard
          documentResult={documentResult}
          onRemove={onRemove}
          previewUrl={previewUrl}
        />
      ) : null}

      {fileName && !previewUrl && processingState === "idle" ? (
        <div className="relative rounded-lg border bg-muted/30 p-4">
          <Button
            className="absolute top-2 right-2 h-8 w-8"
            onClick={onRemove}
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Privacy Notice</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription>
            Your ID is processed by our private OCR service. Only cryptographic
            commitments and encrypted data are stored—never your raw document
            image.
          </CardDescription>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button disabled={!isVerified} onClick={handleContinue}>
          Continue to Liveness Check
        </Button>
      </div>
    </div>
  );
}
