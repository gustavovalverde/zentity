/**
 * BBS+ Serialization Module
 *
 * Unified serialization/deserialization for BBS+ credentials and presentations.
 * Used by both server-side tRPC router and client-side IndexedDB storage.
 *
 * Binary fields (signatures, proofs, public keys) are base64-encoded for JSON transport.
 */

import type {
  BbsCredential,
  BbsPresentation,
  WalletIdentitySubject,
} from "./types";

import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

/**
 * Serialized BBS+ credential for storage/transport.
 * Binary fields are base64-encoded.
 */
export interface SerializedBbsCredential {
  /** Credential ID (generated from content hash) */
  id?: string;
  format: "bbs+vc";
  credentialType?: "wallet";
  issuer: string;
  holder: string;
  issuedAt: string;
  subject: WalletIdentitySubject;
  signature: {
    signature: string;
    header?: string;
    messageCount: number;
  };
  issuerPublicKey: string;
}

/**
 * Serialized BBS+ presentation for transport.
 * Binary fields are base64-encoded.
 */
export interface SerializedBbsPresentation {
  format: "bbs+vp";
  credentialType?: "wallet";
  issuer: string;
  proof: {
    proof: string;
    revealedIndices: number[];
    revealedMessages: string[];
    presentationHeader?: string;
  };
  revealedClaims: Partial<WalletIdentitySubject>;
  issuerPublicKey: string;
  header?: string;
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
