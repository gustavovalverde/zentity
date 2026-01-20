/**
 * BBS+ Cryptographic Primitives
 *
 * Wrapper around @mattrglobal/pairing-crypto that imports the node-specific
 * entry point directly. This bypasses the environment detection in wasm_module.js
 * which can fail with bundlers like Turbopack.
 */
import "server-only";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeWasm = require("@mattrglobal/pairing-crypto/lib/node") as {
  bbs_bls12_381_generate_key_pair: (request?: {
    ikm?: Uint8Array;
    keyInfo?: Uint8Array;
  }) => Promise<{ secretKey: Uint8Array; publicKey: Uint8Array }>;
  bbs_bls12_381_shake_256_sign: (request: {
    secretKey: Uint8Array;
    publicKey: Uint8Array;
    header?: Uint8Array;
    messages: Uint8Array[];
  }) => Promise<Uint8Array>;
  bbs_bls12_381_shake_256_verify: (request: {
    publicKey: Uint8Array;
    header?: Uint8Array;
    messages: Uint8Array[];
    signature: Uint8Array;
  }) => Promise<{ verified: boolean }>;
  bbs_bls12_381_shake_256_proof_gen: (request: {
    publicKey: Uint8Array;
    header?: Uint8Array;
    messages: Array<{ value: Uint8Array; reveal: boolean }>;
    signature: Uint8Array;
    presentationHeader?: Uint8Array;
  }) => Promise<Uint8Array>;
  bbs_bls12_381_shake_256_proof_verify: (request: {
    publicKey: Uint8Array;
    header?: Uint8Array;
    proof: Uint8Array;
    presentationHeader?: Uint8Array;
    messages: Record<number, Uint8Array>;
  }) => Promise<{ verified: boolean }>;
};

/** Key length constants from BLS12-381 curve */
export const BBS_SECRET_KEY_LENGTH = 32;
export const BBS_PUBLIC_KEY_LENGTH = 96;

/**
 * BBS+ BLS12-381 SHAKE-256 ciphersuite.
 * Provides generateKeyPair, sign, verify, deriveProof, verifyProof.
 */
export const bbs = {
  bls12381_shake256: {
    PRIVATE_KEY_LENGTH: BBS_SECRET_KEY_LENGTH,
    PUBLIC_KEY_LENGTH: BBS_PUBLIC_KEY_LENGTH,

    generateKeyPair: nodeWasm.bbs_bls12_381_generate_key_pair,
    sign: nodeWasm.bbs_bls12_381_shake_256_sign,
    verify: nodeWasm.bbs_bls12_381_shake_256_verify,
    deriveProof: nodeWasm.bbs_bls12_381_shake_256_proof_gen,
    verifyProof: nodeWasm.bbs_bls12_381_shake_256_proof_verify,
  },
};
