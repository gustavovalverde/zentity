export type EncryptionLevel = "none" | "standard" | "post-quantum";

export type ShieldColor = "green" | "yellow" | "gray";

export interface SecurityBadgeInput {
  encryptionLevel: EncryptionLevel;
  isPairwise: boolean;
  requiresDpop: boolean;
  signingAlg: string;
}

export function computeShieldColor(input: SecurityBadgeInput): ShieldColor {
  const isPqSigning = input.signingAlg === "ML-DSA-65";
  const isPqEncryption = input.encryptionLevel === "post-quantum";

  if ((isPqSigning || isPqEncryption) && input.isPairwise) {
    return "green";
  }

  const hasModernSigning = input.signingAlg !== "RS256";
  const hasEncryption = input.encryptionLevel !== "none";
  if (hasModernSigning || hasEncryption) {
    return "yellow";
  }

  return "gray";
}
