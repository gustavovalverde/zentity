/**
 * Parsed-tuple intent binding for the OAuth `payment_authorization` RAR.
 *
 * TypeScript mirror of `zally-core/src/intent_hash.rs`. The issuer (this
 * package) and the wallet runtime (zspend-runtime, in zpay's workspace) MUST
 * produce the same SHA-256 digest for the same parsed tuple; otherwise the
 * wallet rejects the issuer's signed authorization and no spend goes through.
 *
 * # Byte layout (locked)
 *
 * ```text
 *   "zentity.payauth.v1"               domain separator (18 bytes)
 *   u16-be(chain_namespace.len()) || chain_namespace.as_bytes()
 *   u16-be(chain_reference.len()) || chain_reference.as_bytes()
 *   u16-be(recipient_caip10.len()) || recipient_caip10.as_bytes()
 *   amount_value as u64 big-endian   8 bytes
 *   amount_unit                      1 byte (0x00 Base, 0x01 Display)
 *   u16-be(payment_id.len()) || payment_id.as_bytes()
 *   expiry_height as u64 big-endian  8 bytes
 * ```
 *
 * # Conformance
 *
 * The constant {@link ZCASH_TESTNET_MINIMAL_VECTOR} below is the canonical
 * conformance vector; the Rust side at `zally-core::intent_hash::tests::
 * conformance_vector_zcash_testnet_minimal` asserts the same expected
 * digest. If either side updates the byte layout, BOTH conformance vectors
 * must update in lockstep; a vector mismatch in CI is the wire break this
 * test exists to catch.
 *
 * Per Proposal-0003 D-4 in zpay's docs/proposals/0003-agent-wallet-production-architecture.md.
 */

import { createHash } from "node:crypto";

/** Domain separator hashed at the start of every intent. ASCII 18 bytes. */
export const INTENT_HASH_DOMAIN_SEPARATOR = "zentity.payauth.v1";

/** Wire-encoded prefix on the printed form of an `IntentHash`. */
export const INTENT_HASH_WIRE_PREFIX = "v1:sha256:";

/** Maximum length of any string field (matches the Rust u16-prefix cap). */
const MAX_FIELD_LEN = 0xff_ff;

/** Unit interpretation of an amount value. */
export type AmountUnit = "base" | "display";

/** Parsed-tuple inputs to {@link intentHash}. */
export interface IntentInput {
  /** Unit interpretation of `amountValue`. */
  amountUnit: AmountUnit;
  /**
   * Amount value in the chain's smallest base unit. Accepts a JS `number`
   * (up to `Number.MAX_SAFE_INTEGER`) or a `bigint` for amounts above
   * 2^53; both are encoded as u64 big-endian on the wire.
   */
  amountValue: number | bigint;
  /** CAIP-2 chain namespace. Zcash: `"zcash"`. EVM: `"eip155"`. */
  chainNamespace: string;
  /** CAIP-2 chain reference. Zcash: `"main"` or `"test"`. */
  chainReference: string;
  /**
   * Chain-specific expiry. Zcash: block height. Solana: slot. EVM: block
   * number. Always 8 bytes big-endian on the wire.
   */
  expiryHeight: number | bigint;
  /** The opaque facilitator-issued payment id. */
  paymentId: string;
  /** CAIP-10 account identifier. The full `namespace:reference:address` form. */
  recipientCaip10: string;
}

/** Error thrown when an input violates an invariant {@link intentHash} enforces. */
export class IntentHashError extends Error {
  readonly kind: "field-too-long" | "unsupported-version" | "payload-invalid";
  constructor(kind: IntentHashError["kind"], message: string) {
    super(message);
    this.kind = kind;
    this.name = "IntentHashError";
  }
}

/**
 * Computes the binding hash over `input`. Throws {@link IntentHashError}
 * when any string field exceeds the u16-prefix cap.
 */
export function intentHash(input: IntentInput): Uint8Array {
  const buffers: Buffer[] = [];

  buffers.push(Buffer.from(INTENT_HASH_DOMAIN_SEPARATOR, "utf8"));
  buffers.push(lenPrefixed("chainNamespace", input.chainNamespace));
  buffers.push(lenPrefixed("chainReference", input.chainReference));
  buffers.push(lenPrefixed("recipientCaip10", input.recipientCaip10));
  buffers.push(u64BigEndian(input.amountValue));
  buffers.push(Buffer.from([amountUnitByte(input.amountUnit)]));
  buffers.push(lenPrefixed("paymentId", input.paymentId));
  buffers.push(u64BigEndian(input.expiryHeight));

  const sha = createHash("sha256");
  for (const buf of buffers) {
    sha.update(buf);
  }
  return new Uint8Array(sha.digest());
}

/** Returns the wire-encoded form: `"v1:sha256:<base64url 32 bytes no pad>"`. */
export function intentHashToWireString(digest: Uint8Array): string {
  if (digest.length !== 32) {
    throw new IntentHashError(
      "payload-invalid",
      `expected 32 bytes, got ${digest.length}`
    );
  }
  return INTENT_HASH_WIRE_PREFIX + base64urlNoPad(digest);
}

/**
 * Parses the wire-encoded form. Throws on any version other than
 * `"v1:sha256:"` or any payload that is not 32 bytes of base64url-no-pad.
 */
export function intentHashFromWireString(s: string): Uint8Array {
  if (!s.startsWith(INTENT_HASH_WIRE_PREFIX)) {
    throw new IntentHashError(
      "unsupported-version",
      "intent hash version not supported (expected v1:sha256:)"
    );
  }
  const encoded = s.slice(INTENT_HASH_WIRE_PREFIX.length);
  let raw: Buffer;
  try {
    raw = Buffer.from(addBase64UrlPadding(encoded), "base64");
  } catch (err) {
    throw new IntentHashError(
      "payload-invalid",
      `base64url decode failed: ${(err as Error).message}`
    );
  }
  if (raw.length !== 32) {
    throw new IntentHashError(
      "payload-invalid",
      `expected 32 bytes, got ${raw.length}`
    );
  }
  return new Uint8Array(raw);
}

function lenPrefixed(field: string, value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > MAX_FIELD_LEN) {
    throw new IntentHashError(
      "field-too-long",
      `intent field ${field} too long: ${bytes.length} bytes (max ${MAX_FIELD_LEN})`
    );
  }
  const prefix = Buffer.allocUnsafe(2);
  prefix.writeUInt16BE(bytes.length, 0);
  return Buffer.concat([prefix, bytes]);
}

function u64BigEndian(value: number | bigint): Buffer {
  const big = typeof value === "bigint" ? value : BigInt(value);
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64BE(big, 0);
  return buf;
}

function amountUnitByte(unit: AmountUnit): number {
  return unit === "base" ? 0x00 : 0x01;
}

const BASE64URL_REPLACE = /[+/=]/g;
const BASE64URL_REPLACEMENTS = { "+": "-", "/": "_", "=": "" } as const;

function base64urlNoPad(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(
      BASE64URL_REPLACE,
      (ch) => BASE64URL_REPLACEMENTS[ch as keyof typeof BASE64URL_REPLACEMENTS]
    );
}

function addBase64UrlPadding(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  return remainder === 0 ? padded : padded + "=".repeat(4 - remainder);
}

/**
 * Canonical conformance vector. The Rust side at
 * `zally-core::intent_hash::tests::conformance_vector_zcash_testnet_minimal`
 * computes the same expected digest for the same input. Updating either
 * side without the other is the wire-shape break the {@link __tests__}
 * suite catches.
 */
export const ZCASH_TESTNET_MINIMAL_VECTOR = {
  input: {
    chainNamespace: "zcash",
    chainReference: "test",
    recipientCaip10: "zcash:test:utest1qq...",
    amountValue: 50_000_000,
    amountUnit: "base" as AmountUnit,
    paymentId: "01KT9A0V431VGD5YH7R7G635HC",
    expiryHeight: 4_047_100,
  },
  expectedDigestHex:
    "b47e481896e757a3714a5f679b06c573c1160c5eab7d871780e7c71669888d44",
} as const;
