export interface FaceMatchResult {
  confidence: number;
  distance: number;
  error?: string | undefined;
  idFaceExtracted: boolean;
  idFaceImage?: string | undefined;
  matched: boolean;
  processingTimeMs: number;
  threshold: number;
}
