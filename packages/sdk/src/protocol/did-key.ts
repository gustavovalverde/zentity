const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index])
);

const DID_KEY_PREFIX = "did:key:";
const MULTIBASE_BASE58BTC_PREFIX = "z";
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);
const ED25519_PUBLIC_KEY_LENGTH = 32;

export interface Ed25519PublicJwk {
  crv: "Ed25519";
  kty: "OKP";
  x: string;
}

interface Ed25519PublicJwkInput {
  crv?: unknown;
  kty?: unknown;
  x?: unknown;
}

export class InvalidDidKeyFormatError extends Error {
  readonly code = "invalid_did_key_format";

  constructor(message = "Invalid Ed25519 did:key value") {
    super(message);
    this.name = "InvalidDidKeyFormatError";
  }
}

function encodeBase58btc(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = `${BASE58_ALPHABET[remainder]}${encoded}`;
    value /= 58n;
  }

  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    encoded = `1${encoded}`;
  }

  return encoded;
}

function decodeBase58btc(value: string): Uint8Array {
  if (value.length === 0) {
    throw new InvalidDidKeyFormatError("Missing did:key multibase payload");
  }

  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) {
      throw new InvalidDidKeyFormatError("did:key is not valid base58btc");
    }
    decoded = decoded * 58n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (decoded > 0n) {
    bytes.unshift(Number(decoded & 0xffn));
    decoded >>= 8n;
  }

  let leadingZeroCount = 0;
  for (const character of value) {
    if (character !== "1") {
      break;
    }
    leadingZeroCount += 1;
  }

  return Uint8Array.from([
    ...Array.from({ length: leadingZeroCount }, () => 0),
    ...bytes,
  ]);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );

  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseEd25519PublicJwk(
  value: Ed25519PublicJwk | Ed25519PublicJwkInput | string
): Ed25519PublicJwk {
  const parsed =
    typeof value === "string"
      ? (JSON.parse(value) as Ed25519PublicJwkInput)
      : value;

  if (
    parsed.kty !== "OKP" ||
    parsed.crv !== "Ed25519" ||
    typeof parsed.x !== "string"
  ) {
    throw new InvalidDidKeyFormatError("Expected an Ed25519 OKP public JWK");
  }

  return parsed as Ed25519PublicJwk;
}

function readEd25519PublicKeyBytes(
  value: Ed25519PublicJwk | Ed25519PublicJwkInput | string
): Uint8Array {
  const bytes = decodeBase64Url(parseEd25519PublicJwk(value).x);
  if (bytes.length !== ED25519_PUBLIC_KEY_LENGTH) {
    throw new InvalidDidKeyFormatError(
      "Ed25519 public keys must be 32 bytes long"
    );
  }
  return bytes;
}

export function encodeEd25519DidKey(publicKeyBytes: Uint8Array): string {
  if (publicKeyBytes.length !== ED25519_PUBLIC_KEY_LENGTH) {
    throw new InvalidDidKeyFormatError(
      "Ed25519 public keys must be 32 bytes long"
    );
  }

  const multicodecBytes = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + publicKeyBytes.length
  );
  multicodecBytes.set(ED25519_MULTICODEC_PREFIX, 0);
  multicodecBytes.set(publicKeyBytes, ED25519_MULTICODEC_PREFIX.length);

  return `${DID_KEY_PREFIX}${MULTIBASE_BASE58BTC_PREFIX}${encodeBase58btc(multicodecBytes)}`;
}

export function decodeEd25519DidKey(didKey: string): Uint8Array {
  if (typeof didKey !== "string" || didKey.length === 0) {
    throw new InvalidDidKeyFormatError();
  }

  if (!didKey.startsWith(DID_KEY_PREFIX)) {
    throw new InvalidDidKeyFormatError("did:key prefix is required");
  }

  const multibaseValue = didKey.slice(DID_KEY_PREFIX.length);
  if (!multibaseValue.startsWith(MULTIBASE_BASE58BTC_PREFIX)) {
    throw new InvalidDidKeyFormatError("did:key must use base58btc multibase");
  }

  const decoded = decodeBase58btc(multibaseValue.slice(1));
  if (decoded.length !== ED25519_MULTICODEC_PREFIX.length + ED25519_PUBLIC_KEY_LENGTH) {
    throw new InvalidDidKeyFormatError(
      "did:key must contain an Ed25519 public key"
    );
  }

  if (
    decoded[0] !== ED25519_MULTICODEC_PREFIX[0] ||
    decoded[1] !== ED25519_MULTICODEC_PREFIX[1]
  ) {
    throw new InvalidDidKeyFormatError(
      "did:key must use the Ed25519 multicodec prefix"
    );
  }

  return decoded.slice(ED25519_MULTICODEC_PREFIX.length);
}

export function isEd25519DidKey(value: unknown): value is string {
  try {
    if (typeof value !== "string") {
      return false;
    }

    decodeEd25519DidKey(value);
    return true;
  } catch {
    return false;
  }
}

export function encodeEd25519DidKeyFromJwk(
  value: Ed25519PublicJwk | Ed25519PublicJwkInput | string
): string {
  return encodeEd25519DidKey(readEd25519PublicKeyBytes(value));
}

export function decodeEd25519DidKeyToJwk(didKey: string): Ed25519PublicJwk {
  return {
    crv: "Ed25519",
    kty: "OKP",
    x: encodeBase64Url(decodeEd25519DidKey(didKey)),
  };
}
