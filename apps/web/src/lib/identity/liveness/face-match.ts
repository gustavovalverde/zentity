export interface FaceMatchResult {
  matched: boolean;
  confidence: number;
  distance: number;
  threshold: number;
  processingTimeMs: number;
  idFaceExtracted: boolean;
  idFaceImage?: string;
  error?: string;
}
