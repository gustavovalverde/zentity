/**
 * BBS+ Holder Operations
 *
 * Client-side proof derivation for selective disclosure.
 * The holder derives proofs from credentials without needing the issuer's secret key.
 */

import type {
  BbsCredential,
  BbsPresentation,
  BbsProof,
  DisclosureRequest,
  WalletCredentialClaimKey,
} from "./types";

import { bbs } from "./crypto";
import { subjectToMessages } from "./signer";
import { getClaimOrder } from "./types";

/**
 * Create disclosure requests from a list of claims to reveal.
 *
 * @param revealClaims - Claim keys to reveal (others will be hidden)
 * @returns Disclosure request array for deriveProof
 */
function createDisclosureRequest(
  revealClaims: WalletCredentialClaimKey[]
): DisclosureRequest[] {
  const claimOrder = getClaimOrder();
  return claimOrder.map((key, index) => ({
    index,
    reveal: (revealClaims as string[]).includes(key),
  }));
}

/**
 * Derive a BBS+ proof with selective disclosure.
 *
 * @param credential - Original signed credential
 * @param disclosures - Which messages to reveal
 * @param presentationHeader - Context binding for the presentation
 * @returns Derived proof revealing only selected messages
 */
async function deriveProof(
  credential: BbsCredential,
  disclosures: DisclosureRequest[],
  presentationHeader?: Uint8Array
): Promise<BbsProof> {
  const messages = subjectToMessages(credential.subject);
  const messageValues = messages.map((m) => m.value);

  // Build messages array with reveal flags
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

  // Extract revealed messages and indices
  const revealedIndices = disclosures
    .filter((d) => d.reveal)
    .map((d) => d.index);
  const revealedMessages = revealedIndices.map((i) => messageValues[i]);

  return {
    proof,
    revealedIndices,
    revealedMessages,
    presentationHeader,
  };
}

/**
 * Create a verifiable presentation from a credential.
 * Convenience function combining disclosure and proof derivation.
 *
 * @param credential - Original signed credential
 * @param revealClaims - Claims to reveal in the presentation
 * @param context - Optional presentation context (e.g., verifier nonce)
 * @returns Verifiable presentation with selective disclosure
 */
export async function createPresentation(
  credential: BbsCredential,
  revealClaims: WalletCredentialClaimKey[],
  context?: string
): Promise<BbsPresentation> {
  const encoder = new TextEncoder();
  const presentationHeader = context ? encoder.encode(context) : undefined;

  const disclosures = createDisclosureRequest(revealClaims);
  const proof = await deriveProof(credential, disclosures, presentationHeader);

  // Build revealed claims object
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
