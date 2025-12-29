export interface AgeProofSummary {
  proofId: string;
  isOver18: boolean;
  generationTimeMs: number | null;
  createdAt: string;
  birthYearOffsetCiphertext: string | null;
  fheEncryptionTimeMs: number | null;
}

export interface AgeProofFull extends AgeProofSummary {
  proof: string | null;
  publicSignals: string[] | null;
  fheKeyId: string | null;
  circuitType: string | null;
  noirVersion: string | null;
  circuitHash: string | null;
  bbVersion: string | null;
}
