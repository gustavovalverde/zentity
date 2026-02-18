export interface AgeProofSummary {
  birthYearOffsetCiphertextBytes: number | null;
  birthYearOffsetCiphertextHash: string | null;
  createdAt: string;
  fheEncryptionTimeMs: number | null;
  generationTimeMs: number | null;
  isOver18: boolean;
  proofId: string;
}

export interface AgeProofFull extends AgeProofSummary {
  bbVersion: string | null;
  circuitHash: string | null;
  circuitType: string | null;
  fheKeyId: string | null;
  noirVersion: string | null;
  proof: string | null;
  publicSignals: string[] | null;
  verificationKeyHash: string | null;
  verificationKeyPoseidonHash: string | null;
}
