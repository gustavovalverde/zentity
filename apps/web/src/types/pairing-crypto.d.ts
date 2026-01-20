/**
 * Type declarations for @mattrglobal/pairing-crypto
 *
 * BBS+ signatures on BLS12-381 curve.
 * Types extracted from source: wrappers/wasm/src/js/index.d.ts
 */

declare module "@mattrglobal/pairing-crypto" {
  interface KeyGenerationRequest {
    ikm?: Uint8Array;
    keyInfo?: Uint8Array;
  }

  interface KeyPair {
    secretKey: Uint8Array;
    publicKey: Uint8Array;
  }

  interface BbsSignRequest {
    secretKey: Uint8Array;
    publicKey: Uint8Array;
    header?: Uint8Array;
    messages: Uint8Array[];
  }

  interface BbsVerifyRequest {
    publicKey: Uint8Array;
    header?: Uint8Array;
    messages: Uint8Array[];
    signature: Uint8Array;
  }

  interface BbsVerifyResult {
    verified: boolean;
  }

  interface BbsDeriveProofMessageRequest {
    value: Uint8Array;
    reveal: boolean;
  }

  interface BbsDeriveProofRequest {
    publicKey: Uint8Array;
    signature: Uint8Array;
    header?: Uint8Array;
    presentationHeader?: Uint8Array;
    verifySignature?: boolean;
    messages: BbsDeriveProofMessageRequest[];
  }

  interface BbsVerifyProofRequest {
    publicKey: Uint8Array;
    header?: Uint8Array;
    presentationHeader?: Uint8Array;
    proof: Uint8Array;
    messages: Record<number, Uint8Array>;
  }

  interface BbsCiphersuite {
    readonly PRIVATE_KEY_LENGTH: number;
    readonly PUBLIC_KEY_LENGTH: number;
    readonly SIGNATURE_LENGTH: number;

    generateKeyPair(request?: KeyGenerationRequest): Promise<KeyPair>;
    sign(request: BbsSignRequest): Promise<Uint8Array>;
    verify(request: BbsVerifyRequest): Promise<BbsVerifyResult>;
    deriveProof(request: BbsDeriveProofRequest): Promise<Uint8Array>;
    verifyProof(request: BbsVerifyProofRequest): Promise<BbsVerifyResult>;
  }

  export const bbs: {
    bls12381_sha256: BbsCiphersuite;
    bls12381_shake256: BbsCiphersuite;
  };
}
