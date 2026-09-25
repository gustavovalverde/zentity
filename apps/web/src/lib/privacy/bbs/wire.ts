/**
 * BBS+ credential wire format.
 *
 * Credential and presentation shapes plus their base64 serialization, shared
 * by the server-side tRPC router and client-side IndexedDB storage. Uses the
 * BLS12-381 curve via @mattrglobal/pairing-crypto for wallet identity
 * credentials (RFC-0020).
 */

import {
  base64ToBytes,
  bytesToBase64,
} from "@/lib/privacy/primitives/symmetric";

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
  header?: Uint8Array | undefined;
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
  presentationHeader?: Uint8Array | undefined;
  /** Derived proof bytes */
  proof: Uint8Array;
  /** Indices of revealed messages */
  revealedIndices: number[];
  /** Revealed message values (in index order) */
  revealedMessages: Uint8Array[];
}

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
  chainId?: number | undefined;
  /** Blockchain network (e.g., "ethereum", "polygon") */
  network: string;
  /** Verification tier achieved */
  tier: number;
  /** ISO 8601 timestamp of verification */
  verifiedAt: string;
  /** Wallet address commitment: hash(address || salt) */
  walletCommitment: string;
}

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
  header?: Uint8Array | undefined;
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
 * Serialized BBS+ credential for storage/transport.
 * Binary fields are base64-encoded.
 */
export interface SerializedBbsCredential {
  credentialType?: "wallet" | undefined;
  format: "bbs+vc";
  holder: string;
  /** Credential ID (generated from content hash) */
  id?: string | undefined;
  issuedAt: string;
  issuer: string;
  issuerPublicKey: string;
  signature: {
    signature: string;
    header?: string | undefined;
    messageCount: number;
  };
  subject: WalletIdentitySubject;
}

/**
 * Serialized BBS+ presentation for transport.
 * Binary fields are base64-encoded.
 */
export interface SerializedBbsPresentation {
  credentialType?: "wallet" | undefined;
  format: "bbs+vp";
  header?: string | undefined;
  issuer: string;
  issuerPublicKey: string;
  proof: {
    proof: string;
    revealedIndices: number[];
    revealedMessages: string[];
    presentationHeader?: string | undefined;
  };
  revealedClaims: Partial<WalletIdentitySubject>;
}

/**
 * Serialize a BBS+ credential for storage or transport.
 */
export function serializeCredential(
  credential: BbsCredential,
  options?: { includeId?: boolean; generateId?: () => string }
): SerializedBbsCredential {
  const serialized: SerializedBbsCredential = {
    format: credential.format,
    credentialType: credential.credentialType,
    issuer: credential.issuer,
    holder: credential.holder,
    issuedAt: credential.issuedAt,
    subject: credential.subject,
    signature: {
      signature: bytesToBase64(credential.signature.signature),
      header: credential.signature.header
        ? bytesToBase64(credential.signature.header)
        : undefined,
      messageCount: credential.signature.messageCount,
    },
    issuerPublicKey: bytesToBase64(credential.issuerPublicKey),
  };

  if (options?.includeId && options.generateId) {
    serialized.id = options.generateId();
  }

  return serialized;
}

/**
 * Deserialize a BBS+ credential from storage or transport format.
 */
export function deserializeCredential(
  data: SerializedBbsCredential
): BbsCredential {
  return {
    format: "bbs+vc",
    credentialType: "wallet",
    issuer: data.issuer,
    holder: data.holder,
    issuedAt: data.issuedAt,
    subject: data.subject,
    signature: {
      signature: base64ToBytes(data.signature.signature),
      header: data.signature.header
        ? base64ToBytes(data.signature.header)
        : undefined,
      messageCount: data.signature.messageCount,
    },
    issuerPublicKey: base64ToBytes(data.issuerPublicKey),
  };
}

/**
 * Serialize a BBS+ presentation for transport.
 */
export function serializePresentation(
  presentation: BbsPresentation
): SerializedBbsPresentation {
  return {
    format: presentation.format,
    credentialType: presentation.credentialType,
    issuer: presentation.issuer,
    proof: {
      proof: bytesToBase64(presentation.proof.proof),
      revealedIndices: presentation.proof.revealedIndices,
      revealedMessages: presentation.proof.revealedMessages.map((m) =>
        bytesToBase64(m)
      ),
      presentationHeader: presentation.proof.presentationHeader
        ? bytesToBase64(presentation.proof.presentationHeader)
        : undefined,
    },
    revealedClaims: presentation.revealedClaims,
    issuerPublicKey: bytesToBase64(presentation.issuerPublicKey),
    header: presentation.header
      ? bytesToBase64(presentation.header)
      : undefined,
  };
}

/**
 * Deserialize a BBS+ presentation from transport format.
 */
export function deserializePresentation(
  data: SerializedBbsPresentation
): BbsPresentation {
  return {
    format: "bbs+vp",
    credentialType: "wallet",
    issuer: data.issuer,
    proof: {
      proof: base64ToBytes(data.proof.proof),
      revealedIndices: data.proof.revealedIndices,
      revealedMessages: data.proof.revealedMessages.map((m) =>
        base64ToBytes(m)
      ),
      presentationHeader: data.proof.presentationHeader
        ? base64ToBytes(data.proof.presentationHeader)
        : undefined,
    },
    revealedClaims: data.revealedClaims,
    issuerPublicKey: base64ToBytes(data.issuerPublicKey),
    header: data.header ? base64ToBytes(data.header) : undefined,
  };
}
