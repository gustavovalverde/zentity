import crypto from "node:crypto";

import { db } from "@/lib/db/connection";
import { passkeys } from "@/lib/db/schema/auth";

const TEST_RP_ID = "localhost";
const TEST_ORIGIN = "http://localhost:3000";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

/** A CBOR item header (RFC 8949 §3) for lengths below 65536. */
function cborHeader(majorType: number, length: number): Buffer {
  const major = majorType * 32;
  if (length < 24) {
    return Buffer.from([major + length]);
  }
  if (length < 256) {
    return Buffer.from([major + 24, length]);
  }
  return Buffer.from([major + 25, Math.floor(length / 256), length % 256]);
}

function cborText(text: string): Buffer {
  const bytes = Buffer.from(text, "utf8");
  return Buffer.concat([cborHeader(3, bytes.length), bytes]);
}

function cborBytes(bytes: Buffer): Buffer {
  return Buffer.concat([cborHeader(2, bytes.length), bytes]);
}

function base64Url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString("base64url");
}

/** COSE_Key for an EC2 P-256 ES256 public key (RFC 9053 §7.1.1). */
function coseEc2PublicKey(jwk: JsonWebKey): Buffer {
  const x = Buffer.from(jwk.x ?? "", "base64url");
  const y = Buffer.from(jwk.y ?? "", "base64url");
  return Buffer.concat([
    Buffer.from([0xa5]),
    Buffer.from([0x01, 0x02]),
    Buffer.from([0x03, 0x26]),
    Buffer.from([0x20, 0x01]),
    Buffer.from([0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]);
}

export interface TestAssertionOptions {
  challenge: string;
  /** Signature counter; defaults to one more than the last assertion. */
  counter?: number;
  origin?: string;
  rpId?: string;
  type?: string;
  userPresent?: boolean;
  userVerified?: boolean;
}

export interface TestAttestationOptions {
  challenge: string;
  origin?: string;
  rpId?: string;
  userVerified?: boolean;
}

/** The JSON a browser posts for a WebAuthn registration. */
export interface TestAttestationResponse {
  authenticatorAttachment: "platform";
  clientExtensionResults: Record<string, never>;
  id: string;
  rawId: string;
  response: {
    attestationObject: string;
    clientDataJSON: string;
    transports: string[];
  };
  type: "public-key";
}

/** The JSON a browser posts for a WebAuthn assertion. */
export interface TestAssertionResponse {
  authenticatorAttachment: "platform";
  clientExtensionResults: Record<string, never>;
  id: string;
  rawId: string;
  response: {
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle?: string;
  };
  type: "public-key";
}

/**
 * A software P-256 passkey: registers a passkey row for a user and signs
 * assertions with chosen flags and counters, as an authenticator would.
 */
export class TestAuthenticator {
  readonly credentialId: string;
  readonly passkeyId: string;
  private readonly privateKey: crypto.KeyObject;
  private readonly publicJwk: JsonWebKey;
  private counter = 0;

  constructor() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    this.privateKey = privateKey;
    this.publicJwk = publicKey.export({ format: "jwk" });
    this.credentialId = base64Url(crypto.randomBytes(16));
    this.passkeyId = crypto.randomUUID();
  }

  /** Stores the passkey the way the passkey plugin stores a registration. */
  async register(userId: string, counter = 0): Promise<this> {
    this.counter = counter;
    await db
      .insert(passkeys)
      .values({
        id: this.passkeyId,
        name: "Test passkey",
        publicKey: coseEc2PublicKey(this.publicJwk).toString("base64"),
        userId,
        credentialID: this.credentialId,
        counter,
        deviceType: "singleDevice",
        backedUp: false,
        transports: "internal",
      })
      .run();
    return this;
  }

  /**
   * Creates this passkey the way a browser registers one, with a `none`
   * attestation, for the passkey plugin's `verify-registration`.
   */
  attest(options: TestAttestationOptions): TestAttestationResponse {
    const credentialId = Buffer.from(this.credentialId, "base64url");
    const flags =
      FLAG_USER_PRESENT +
      FLAG_ATTESTED_CREDENTIAL_DATA +
      (options.userVerified === false ? 0 : FLAG_USER_VERIFIED);
    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(credentialId.length);
    const authenticatorData = Buffer.concat([
      crypto
        .createHash("sha256")
        .update(options.rpId ?? TEST_RP_ID)
        .digest(),
      Buffer.from([flags]),
      Buffer.alloc(4),
      Buffer.alloc(16),
      credentialIdLength,
      credentialId,
      coseEc2PublicKey(this.publicJwk),
    ]);
    const attestationObject = Buffer.concat([
      cborHeader(5, 3),
      cborText("fmt"),
      cborText("none"),
      cborText("attStmt"),
      cborHeader(5, 0),
      cborText("authData"),
      cborBytes(authenticatorData),
    ]);
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge: options.challenge,
        origin: options.origin ?? TEST_ORIGIN,
        crossOrigin: false,
      })
    );
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        attestationObject: base64Url(attestationObject),
        clientDataJSON: base64Url(clientDataJSON),
        transports: ["internal"],
      },
    };
  }

  assert(options: TestAssertionOptions): TestAssertionResponse {
    this.counter = options.counter ?? this.counter + 1;
    // Distinct flag bits, so the sum is their union.
    const flags =
      (options.userPresent === false ? 0 : FLAG_USER_PRESENT) +
      (options.userVerified === false ? 0 : FLAG_USER_VERIFIED);
    const counterBytes = Buffer.alloc(4);
    counterBytes.writeUInt32BE(this.counter);
    const authenticatorData = Buffer.concat([
      crypto
        .createHash("sha256")
        .update(options.rpId ?? TEST_RP_ID)
        .digest(),
      Buffer.from([flags]),
      counterBytes,
    ]);
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: options.type ?? "webauthn.get",
        challenge: options.challenge,
        origin: options.origin ?? TEST_ORIGIN,
        crossOrigin: false,
      })
    );
    const signature = crypto.sign(
      "sha256",
      Buffer.concat([
        authenticatorData,
        crypto.createHash("sha256").update(clientDataJSON).digest(),
      ]),
      this.privateKey
    );
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        authenticatorData: base64Url(authenticatorData),
        clientDataJSON: base64Url(clientDataJSON),
        signature: base64Url(signature),
      },
    };
  }
}
