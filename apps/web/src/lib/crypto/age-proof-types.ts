export interface AgeProofSummary {
  proofId: string;
  isOver18: boolean;
  generationTimeMs: number | null;
  createdAt: string;
  birthYearOffsetCiphertextHash: string | null;
  birthYearOffsetCiphertextBytes: number | null;
  fheEncryptionTimeMs: number | null;
}

export interface AgeProofFull extends AgeProofSummary {
  proof: string | null;
  publicSignals: string[] | null;
  fheKeyId: string | null;
  circuitType: string | null;
  noirVersion: string | null;
  circuitHash: string | null;
  verificationKeyHash: string | null;
  verificationKeyPoseidonHash: string | null;
  bbVersion: string | null;
}
