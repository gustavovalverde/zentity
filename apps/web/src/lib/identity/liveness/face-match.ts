export interface FaceMatchResult {
  confidence: number;
  distance: number;
  error?: string;
  idFaceExtracted: boolean;
  idFaceImage?: string;
  matched: boolean;
  processingTimeMs: number;
  threshold: number;
}
