export interface AgeProofSummary {
  proofId: string;
  isOver18: boolean;
  generationTimeMs: number | null;
  createdAt: string;
  dobCiphertext: string | null;
  fheEncryptionTimeMs: number | null;
}

export interface AgeProofFull extends AgeProofSummary {
  proof: string | null;
  publicSignals: string[] | null;
  fheClientKeyId: string | null;
  circuitType: string | null;
  noirVersion: string | null;
  circuitHash: string | null;
  bbVersion: string | null;
}

export interface AgeProofPayload {
  proof: string;
  publicSignals: string[];
  isOver18: boolean;
}
