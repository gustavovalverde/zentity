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
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  }

  interface BbsSignRequest {
    header?: Uint8Array;
    messages: Uint8Array[];
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  }

  interface BbsVerifyRequest {
    header?: Uint8Array;
    messages: Uint8Array[];
    publicKey: Uint8Array;
    signature: Uint8Array;
  }

  interface BbsVerifyResult {
    verified: boolean;
  }

  interface BbsDeriveProofMessageRequest {
    reveal: boolean;
    value: Uint8Array;
  }

  interface BbsDeriveProofRequest {
    header?: Uint8Array;
    messages: BbsDeriveProofMessageRequest[];
    presentationHeader?: Uint8Array;
    publicKey: Uint8Array;
    signature: Uint8Array;
    verifySignature?: boolean;
  }

  interface BbsVerifyProofRequest {
    header?: Uint8Array;
    messages: Record<number, Uint8Array>;
    presentationHeader?: Uint8Array;
    proof: Uint8Array;
    publicKey: Uint8Array;
  }

  interface BbsCiphersuite {
    deriveProof(request: BbsDeriveProofRequest): Promise<Uint8Array>;

    generateKeyPair(request?: KeyGenerationRequest): Promise<KeyPair>;
    readonly PRIVATE_KEY_LENGTH: number;
    readonly PUBLIC_KEY_LENGTH: number;
    readonly SIGNATURE_LENGTH: number;
    sign(request: BbsSignRequest): Promise<Uint8Array>;
    verify(request: BbsVerifyRequest): Promise<BbsVerifyResult>;
    verifyProof(request: BbsVerifyProofRequest): Promise<BbsVerifyResult>;
  }

  export const bbs: {
    bls12381_sha256: BbsCiphersuite;
    bls12381_shake256: BbsCiphersuite;
  };
}
