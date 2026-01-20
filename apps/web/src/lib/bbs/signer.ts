/**
 * BBS+ Credential Signer
 *
 * Server-side signing of BBS+ wallet credentials (RFC-0020).
 * Creates credentials that support selective disclosure for
 * wallet binding in the identity circuit.
 */

import type {
  BbsCredential,
  BbsKeyPair,
  BbsMessage,
  BbsSignature,
  WalletIdentitySubject,
} from "./types";

import { bbs } from "./crypto";
import { getClaimOrder } from "./types";

/**
 * Encode a claim value to bytes for BBS+ signing.
 */
function encodeClaimValue(
  value: string | number | boolean | undefined
): Uint8Array {
  const encoder = new TextEncoder();
  if (value === undefined) {
    return encoder.encode("");
  }
  return encoder.encode(String(value));
}

/**
 * Convert credential subject to ordered BBS+ messages.
 * Order must be consistent between signing and verification.
 */
export function subjectToMessages(
  subject: WalletIdentitySubject
): BbsMessage[] {
  const claimOrder = getClaimOrder();
  const subjectRecord = subject as unknown as Record<
    string,
    string | number | boolean | undefined
  >;
  return claimOrder.map((key) => ({
    id: key,
    value: encodeClaimValue(subjectRecord[key]),
  }));
}

/**
 * Sign a set of messages with BBS+.
 *
 * @param messages - Ordered messages to sign
 * @param keyPair - Issuer's BBS+ keypair
 * @param header - Optional header for domain binding
 * @returns BBS+ signature over all messages
 */
async function signMessages(
  messages: BbsMessage[],
  keyPair: BbsKeyPair,
  header?: Uint8Array
): Promise<BbsSignature> {
  const messageValues = messages.map((m) => m.value);

  const signature = await bbs.bls12381_shake256.sign({
    secretKey: keyPair.secretKey,
    publicKey: keyPair.publicKey,
    header: header ?? new Uint8Array(0),
    messages: messageValues,
  });

  return {
    signature,
    header,
    messageCount: messages.length,
  };
}

/**
 * Create a signed BBS+ wallet credential (RFC-0020).
 * For wallet binding in identity circuit during wallet auth.
 *
 * @param subject - Wallet identity claims to include
 * @param issuerKeyPair - Issuer's BBS+ signing keypair
 * @param issuerDid - Issuer's DID (e.g., "did:web:zentity.xyz")
 * @param holderDid - Holder's DID (e.g., "did:key:z6Mk...")
 * @returns Signed BBS+ credential
 */
export async function createWalletCredential(
  subject: WalletIdentitySubject,
  issuerKeyPair: BbsKeyPair,
  issuerDid: string,
  holderDid: string
): Promise<BbsCredential> {
  const issuedAt = new Date().toISOString();
  const messages = subjectToMessages(subject);

  const encoder = new TextEncoder();
  const header = encoder.encode(
    JSON.stringify({
      issuer: issuerDid,
      holder: holderDid,
      issuedAt,
      type: "wallet",
    })
  );

  const signature = await signMessages(messages, issuerKeyPair, header);

  return {
    format: "bbs+vc",
    credentialType: "wallet",
    issuer: issuerDid,
    holder: holderDid,
    issuedAt,
    subject,
    signature,
    issuerPublicKey: issuerKeyPair.publicKey,
  };
}

/**
 * Verify a BBS+ signature over messages.
 * Used to verify credentials before storing or processing.
 *
 * @param signature - BBS+ signature to verify
 * @param messages - Original messages that were signed
 * @param publicKey - Issuer's public key
 * @returns True if signature is valid
 */
export async function verifySignature(
  signature: BbsSignature,
  messages: BbsMessage[],
  publicKey: Uint8Array
): Promise<boolean> {
  const messageValues = messages.map((m) => m.value);

  const result = await bbs.bls12381_shake256.verify({
    publicKey,
    header: signature.header ?? new Uint8Array(0),
    messages: messageValues,
    signature: signature.signature,
  });

  return result.verified;
}

/**
 * Verify a complete BBS+ credential.
 *
 * @param credential - Credential to verify
 * @returns True if credential signature is valid
 */
export async function verifyCredential(
  credential: BbsCredential
): Promise<boolean> {
  const messages = subjectToMessages(credential.subject);
  return await verifySignature(
    credential.signature,
    messages,
    credential.issuerPublicKey
  );
}
