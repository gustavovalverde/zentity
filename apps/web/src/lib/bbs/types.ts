/**
 * BBS+ Signature Types
 *
 * Types for BBS+ credentials with selective disclosure.
 * Uses BLS12-381 curve via @mattrglobal/pairing-crypto.
 *
 * Used for wallet identity credentials (RFC-0020) for internal
 * identity circuit binding during wallet authentication.
 */

/**
 * BBS+ keypair for signing/verification.
 * - secretKey: 32 bytes (BLS12-381 scalar)
 * - publicKey: 96 bytes (BLS12-381 G2 point)
 */
export interface BbsKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * A message in a BBS+ credential.
 * Each message is a claim that can be selectively disclosed.
 */
export interface BbsMessage {
  /** Claim identifier */
  id: string;
  /** Claim value as bytes (will be hashed internally by BBS+) */
  value: Uint8Array;
}

/**
 * BBS+ signature over a set of messages.
 * The signature is 80 bytes for BLS12-381 SHAKE256 ciphersuite.
 */
export interface BbsSignature {
  /** Header bound to signature (optional context) */
  header?: Uint8Array;
  /** Number of messages signed */
  messageCount: number;
  /** Raw signature bytes */
  signature: Uint8Array;
}

/**
 * Selective disclosure request.
 * Specifies which messages to reveal in a derived proof.
 */
export interface DisclosureRequest {
  /** Message index to reveal/hide */
  index: number;
  /** Whether to reveal this message */
  reveal: boolean;
}

/**
 * BBS+ derived proof with selective disclosure.
 * Proves knowledge of hidden messages without revealing them.
 */
export interface BbsProof {
  /** Presentation header (binds proof to context) */
  presentationHeader?: Uint8Array;
  /** Derived proof bytes */
  proof: Uint8Array;
  /** Indices of revealed messages */
  revealedIndices: number[];
  /** Revealed message values (in index order) */
  revealedMessages: Uint8Array[];
}

// ============================================================================
// Wallet Identity Credential (RFC-0020)
// For internal identity circuit binding during wallet auth
// ============================================================================

/**
 * Claim ordering for wallet identity BBS+ credentials.
 */
export const WALLET_CREDENTIAL_CLAIM_ORDER = [
  "walletCommitment",
  "network",
  "chainId",
  "verifiedAt",
  "tier",
] as const;

export type WalletCredentialClaimKey =
  (typeof WALLET_CREDENTIAL_CLAIM_ORDER)[number];

/**
 * Wallet identity credential subject.
 * Claims for wallet binding in identity circuit.
 */
export interface WalletIdentitySubject {
  /** Chain ID (optional, for EVM chains) */
  chainId?: number;
  /** Blockchain network (e.g., "ethereum", "polygon") */
  network: string;
  /** Verification tier achieved */
  tier: number;
  /** ISO 8601 timestamp of verification */
  verifiedAt: string;
  /** Wallet address commitment: hash(address || salt) */
  walletCommitment: string;
}

// ============================================================================
// Credential Types
// ============================================================================

/**
 * Credential type identifier.
 */
export type CredentialType = "wallet";

/**
 * Full BBS+ credential with signature.
 * Format follows W3C VC Data Model where applicable.
 */
export interface BbsCredential {
  /** Credential type for claim ordering */
  credentialType: CredentialType;
  /** Credential format identifier */
  format: "bbs+vc";
  /** Holder DID (did:key from Ed25519 public key) */
  holder: string;
  /** ISO 8601 issuance timestamp */
  issuedAt: string;
  /** Issuer DID (did:web:zentity.xyz) */
  issuer: string;
  /** Issuer public key for verification */
  issuerPublicKey: Uint8Array;
  /** BBS+ signature over claims */
  signature: BbsSignature;
  /** Credential subject claims */
  subject: WalletIdentitySubject;
}

/**
 * Verifiable presentation with derived BBS+ proof.
 * Contains only revealed claims and proof of hidden ones.
 */
export interface BbsPresentation {
  /** Credential type for claim ordering */
  credentialType: CredentialType;
  /** Presentation format */
  format: "bbs+vp";
  /** Original credential header */
  header?: Uint8Array;
  /** Original credential issuer */
  issuer: string;
  /** Issuer public key for verification */
  issuerPublicKey: Uint8Array;
  /** Derived proof with selective disclosure */
  proof: BbsProof;
  /** Revealed claims (subset of original) */
  revealedClaims: Partial<WalletIdentitySubject>;
}

/**
 * Result of BBS+ proof verification.
 */
export interface BbsVerifyResult {
  /** Error message if verification failed */
  error?: string;
  /** Whether verification succeeded */
  verified: boolean;
}

/**
 * Get claim order for wallet credentials.
 */
export function getClaimOrder(): readonly string[] {
  return WALLET_CREDENTIAL_CLAIM_ORDER;
}
