/**
 * BBS+ Credential Operations
 *
 * Server-side BBS+ key derivation, credential signing, proof derivation, and
 * verification for wallet binding (RFC-0020). Selective disclosure lets a
 * holder reveal a subset of claims while proving the rest exist.
 */

import "server-only";

import type {
  BbsCredential,
  BbsKeyPair,
  BbsMessage,
  BbsPresentation,
  BbsProof,
  BbsSignature,
  BbsVerifyResult,
  DisclosureRequest,
  WalletCredentialClaimKey,
  WalletIdentitySubject,
} from "./wire";

import { bbs } from "./curve";
import { WALLET_CREDENTIAL_CLAIM_ORDER } from "./wire";

const textEncoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

async function generateBbsKeyPair(
  ikm?: Uint8Array,
  keyInfo?: Uint8Array
): Promise<BbsKeyPair> {
  const keyPair = await bbs.bls12381_shake256.generateKeyPair({
    ikm: ikm ?? crypto.getRandomValues(new Uint8Array(32)),
    keyInfo: keyInfo ?? new Uint8Array(0),
  });

  return {
    secretKey: keyPair.secretKey,
    publicKey: keyPair.publicKey,
  };
}

/**
 * Derive a BBS+ keypair deterministically from seed material.
 * Useful for deriving issuer keys from a master secret.
 *
 * @param seed - Seed material (minimum 32 bytes)
 * @param context - Domain separation context (e.g., "zentity-bbs-issuer-v1")
 */
export async function deriveBbsKeyPair(
  seed: Uint8Array,
  context: string
): Promise<BbsKeyPair> {
  if (seed.length < 32) {
    throw new Error("Seed must be at least 32 bytes");
  }

  const keyInfo = textEncoder.encode(context);
  return await generateBbsKeyPair(seed.slice(0, 32), keyInfo);
}

// ---------------------------------------------------------------------------
// Credential signing
// ---------------------------------------------------------------------------

function encodeClaimValue(
  value: string | number | boolean | undefined
): Uint8Array {
  if (value === undefined) {
    return textEncoder.encode("");
  }
  return textEncoder.encode(String(value));
}

/**
 * Convert credential subject to ordered BBS+ messages.
 * Order must be consistent between signing and verification.
 */
function subjectToMessages(subject: WalletIdentitySubject): BbsMessage[] {
  const subjectRecord = subject as unknown as Record<
    string,
    string | number | boolean | undefined
  >;
  return WALLET_CREDENTIAL_CLAIM_ORDER.map((key) => ({
    id: key,
    value: encodeClaimValue(subjectRecord[key]),
  }));
}

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
 */
export async function createWalletCredential(
  subject: WalletIdentitySubject,
  issuerKeyPair: BbsKeyPair,
  issuerDid: string,
  holderDid: string
): Promise<BbsCredential> {
  const issuedAt = new Date().toISOString();
  const messages = subjectToMessages(subject);

  const header = textEncoder.encode(
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

async function verifySignature(
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
 * Verify a complete BBS+ credential signature.
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

// ---------------------------------------------------------------------------
// Proof derivation (holder)
// ---------------------------------------------------------------------------

/**
 * Create disclosure requests from a list of claims to reveal.
 */
function createDisclosureRequest(
  revealClaims: WalletCredentialClaimKey[]
): DisclosureRequest[] {
  return WALLET_CREDENTIAL_CLAIM_ORDER.map((key, index) => ({
    index,
    reveal: (revealClaims as string[]).includes(key),
  }));
}

async function deriveProof(
  credential: BbsCredential,
  disclosures: DisclosureRequest[],
  presentationHeader?: Uint8Array
): Promise<BbsProof> {
  const messages = subjectToMessages(credential.subject);
  const messageValues = messages.map((m) => m.value);

  const messagesWithDisclosure = messageValues.map((value, index) => {
    const disclosure = disclosures.find((d) => d.index === index);
    return {
      value,
      reveal: disclosure?.reveal ?? false,
    };
  });

  const proof = await bbs.bls12381_shake256.deriveProof({
    publicKey: credential.issuerPublicKey,
    signature: credential.signature.signature,
    header: credential.signature.header ?? new Uint8Array(0),
    presentationHeader: presentationHeader ?? new Uint8Array(0),
    messages: messagesWithDisclosure,
  });

  const revealedIndices = disclosures
    .filter((d) => d.reveal)
    .map((d) => d.index);
  const revealedMessages = revealedIndices
    .map((i) => messageValues[i])
    .filter((m): m is Uint8Array => m !== undefined);

  return {
    proof,
    revealedIndices,
    revealedMessages,
    presentationHeader,
  };
}

/**
 * Create a verifiable presentation from a credential with selective disclosure.
 */
export async function createPresentation(
  credential: BbsCredential,
  revealClaims: WalletCredentialClaimKey[],
  context?: string
): Promise<BbsPresentation> {
  const presentationHeader = context ? textEncoder.encode(context) : undefined;

  const disclosures = createDisclosureRequest(revealClaims);
  const proof = await deriveProof(credential, disclosures, presentationHeader);

  const revealedClaims: Partial<BbsCredential["subject"]> = {};
  const subjectRecord = credential.subject as unknown as Record<
    string,
    unknown
  >;
  for (const claim of revealClaims) {
    const value = subjectRecord[claim];
    if (value !== undefined) {
      (revealedClaims as Record<string, unknown>)[claim] = value;
    }
  }

  return {
    format: "bbs+vp",
    credentialType: credential.credentialType,
    issuer: credential.issuer,
    proof,
    revealedClaims,
    issuerPublicKey: credential.issuerPublicKey,
    header: credential.signature.header,
  };
}

// ---------------------------------------------------------------------------
// Proof verification (verifier)
// ---------------------------------------------------------------------------

async function verifyProof(
  proof: BbsProof,
  publicKey: Uint8Array,
  header?: Uint8Array
): Promise<BbsVerifyResult> {
  const totalMessages = WALLET_CREDENTIAL_CLAIM_ORDER.length;

  try {
    if (proof.revealedIndices.length !== proof.revealedMessages.length) {
      return {
        verified: false,
        error: "Mismatch between revealed indices and messages count",
      };
    }

    const messages: Record<number, Uint8Array> = {};
    for (let i = 0; i < proof.revealedIndices.length; i++) {
      const index = proof.revealedIndices[i];
      const message = proof.revealedMessages[i];
      if (index !== undefined && message !== undefined) {
        messages[index] = message;
      }
    }

    for (const index of proof.revealedIndices) {
      if (index < 0 || index >= totalMessages) {
        return {
          verified: false,
          error: `Invalid message index: ${index}`,
        };
      }
    }

    const result = await bbs.bls12381_shake256.verifyProof({
      publicKey,
      header: header ?? new Uint8Array(0),
      presentationHeader: proof.presentationHeader ?? new Uint8Array(0),
      proof: proof.proof,
      messages,
    });

    return { verified: result.verified };
  } catch (error) {
    return {
      verified: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}

/**
 * Verify a complete BBS+ presentation.
 */
export async function verifyPresentation(
  presentation: BbsPresentation
): Promise<BbsVerifyResult> {
  return await verifyProof(
    presentation.proof,
    presentation.issuerPublicKey,
    presentation.header
  );
}
