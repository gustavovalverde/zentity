"use client";

import { base64UrlToBytes, bytesToBase64Url } from "@/lib/utils/base64url";

export interface PrfSupportStatus {
  supported: boolean;
  reason?: string;
}

/**
 * Extracted credential data for storage after registration.
 * This data is needed for server-side verification during authentication.
 */
export interface CredentialRegistrationData {
  credentialId: string;
  publicKey: string; // Base64URL-encoded COSE public key
  counter: number;
  deviceType: "platform" | "cross-platform" | null;
  backedUp: boolean;
  transports: AuthenticatorTransport[];
}

/**
 * Assertion data returned from authentication.
 * This is what gets sent to the server for verification.
 */
export interface AuthenticationAssertionData {
  credentialId: string;
  clientDataJSON: string; // Base64URL-encoded
  authenticatorData: string; // Base64URL-encoded
  signature: string; // Base64URL-encoded
  userHandle: string | null; // Base64URL-encoded user ID
}

const PRF_OUTPUT_LENGTH = 32;

interface PrfExtensionResults {
  prf?: {
    enabled?: boolean;
    results?: { first?: ArrayBuffer };
    resultsByCredential?: Record<string, ArrayBuffer>;
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function assertUserActivation() {
  if (typeof navigator === "undefined" || !("userActivation" in navigator)) {
    return;
  }
  const activation = navigator.userActivation;
  if (!(activation?.isActive || activation?.hasBeenActive)) {
    throw new Error("Passkey unlock must be triggered by a user gesture.");
  }
}

function toPrfOutput(output?: ArrayBuffer): Uint8Array | null {
  if (!output) {
    return null;
  }
  const bytes = new Uint8Array(output);
  if (bytes.byteLength !== PRF_OUTPUT_LENGTH) {
    throw new Error("Unexpected PRF output length.");
  }
  return bytes;
}

export async function checkPrfSupport(): Promise<PrfSupportStatus> {
  if (!globalThis.PublicKeyCredential) {
    return { supported: false, reason: "WebAuthn is not available." };
  }

  const getClientCapabilities = (
    PublicKeyCredential as typeof PublicKeyCredential & {
      getClientCapabilities?: (
        ...args: unknown[]
      ) => Promise<Record<string, unknown>>;
    }
  ).getClientCapabilities;

  if (getClientCapabilities) {
    try {
      let caps: Record<string, unknown> | undefined;
      try {
        caps = await getClientCapabilities();
      } catch {
        // Some implementations may require a "public-key" hint.
        caps = await getClientCapabilities("public-key");
      }

      if (caps) {
        const extensionKey = "extension:prf";
        const extensionValue = caps[extensionKey];
        const directValue = (caps as { prf?: unknown }).prf;
        const extensions = (caps as { extensions?: unknown }).extensions;
        const extensionsArray = Array.isArray(extensions) ? extensions : null;

        if (
          extensionValue === false ||
          directValue === false ||
          (extensionsArray && !extensionsArray.includes("prf"))
        ) {
          return { supported: false, reason: "PRF extension not supported." };
        }
        if (
          extensionValue === true ||
          directValue === true ||
          extensionsArray?.includes("prf")
        ) {
          return { supported: true };
        }
      }
    } catch {
      // Fall through to runtime checks.
    }
  }

  return { supported: true };
}

export async function createCredentialWithPrf(
  options: PublicKeyCredentialCreationOptions
): Promise<{
  credential: PublicKeyCredential;
  credentialId: string;
  prfEnabled: boolean;
  prfOutput: Uint8Array | null;
}> {
  if (!navigator.credentials?.create) {
    throw new Error("WebAuthn credential creation is unavailable.");
  }

  assertUserActivation();

  const prfOptions: PublicKeyCredentialCreationOptions = {
    ...options,
    extensions: {
      ...options.extensions,
      prf: options.extensions?.prf ?? {},
    },
  };

  const credential = (await navigator.credentials.create({
    publicKey: prfOptions,
  })) as PublicKeyCredential;

  const extensionResults = credential.getClientExtensionResults() as
    | PrfExtensionResults
    | undefined;
  const prfEnabled = extensionResults?.prf?.enabled === true;
  const prfOutput = toPrfOutput(extensionResults?.prf?.results?.first);

  return {
    credential,
    credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
    prfEnabled,
    prfOutput,
  };
}

/**
 * Extract registration data from a credential for server-side storage.
 * Call this after createCredentialWithPrf() to get the data needed for auth.
 */
export function extractCredentialRegistrationData(
  credential: PublicKeyCredential
): CredentialRegistrationData {
  const response = credential.response as AuthenticatorAttestationResponse;

  // Parse authenticator data to extract COSE public key
  const authData = new Uint8Array(response.getAuthenticatorData());

  // Flags byte is at offset 32 (after rpIdHash)
  const flags = authData[32];
  // Bit 0 = User Present, Bit 2 = User Verified, Bit 3 = Backup Eligibility, Bit 4 = Backed Up
  // Bit 6 = Attested credential data included
  const backedUp = (flags & 0x10) !== 0;
  const hasAttestedCredentialData = (flags & 0x40) !== 0;

  // Get counter (bytes 33-36, big-endian)
  const counterView = new DataView(
    authData.buffer,
    authData.byteOffset + 33,
    4
  );
  const counter = counterView.getUint32(0, false);

  // Extract COSE public key from attested credential data
  // Structure: rpIdHash(32) + flags(1) + counter(4) + aaguid(16) + credIdLen(2) + credId(n) + coseKey(rest)
  if (!hasAttestedCredentialData) {
    throw new Error(
      "Authenticator data does not contain attested credential data."
    );
  }

  // Skip to attested credential data (after rpIdHash + flags + counter = 37 bytes)
  let offset = 37;

  // Skip aaguid (16 bytes)
  offset += 16;

  // Read credential ID length (2 bytes, big-endian)
  const credIdLenView = new DataView(
    authData.buffer,
    authData.byteOffset + offset,
    2
  );
  const credIdLen = credIdLenView.getUint16(0, false);
  offset += 2;

  // Skip credential ID
  offset += credIdLen;

  // Remaining bytes are the COSE public key
  const cosePublicKey = authData.slice(offset);
  if (cosePublicKey.length === 0) {
    throw new Error(
      "Unable to extract COSE public key from authenticator data."
    );
  }

  // Determine device type from authenticator attachment
  const attachment = credential.authenticatorAttachment;
  let deviceType: "platform" | "cross-platform" | null = null;
  if (attachment === "platform") {
    deviceType = "platform";
  } else if (attachment === "cross-platform") {
    deviceType = "cross-platform";
  }

  // Get transports
  const transports =
    (response.getTransports?.() as AuthenticatorTransport[]) ?? [];

  return {
    credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
    publicKey: bytesToBase64Url(cosePublicKey),
    counter,
    deviceType,
    backedUp,
    transports,
  };
}

/**
 * Authenticate with a passkey (without PRF).
 * Use this for simple login when you don't need to unlock FHE keys.
 */
export async function authenticateWithPasskey(params: {
  challenge: Uint8Array;
  allowCredentials?: { id: string; transports?: AuthenticatorTransport[] }[];
  userVerification?: UserVerificationRequirement;
  timeoutMs?: number;
}): Promise<{
  assertion: AuthenticationAssertionData;
  selectedCredentialId: string;
}> {
  if (!navigator.credentials?.get) {
    throw new Error("WebAuthn authentication is unavailable.");
  }

  assertUserActivation();

  const allowCredentials = params.allowCredentials?.map((cred) => ({
    type: "public-key" as const,
    id: toArrayBuffer(base64UrlToBytes(cred.id)),
    transports: cred.transports,
  }));

  const options: PublicKeyCredentialRequestOptions = {
    challenge: toArrayBuffer(params.challenge),
    allowCredentials,
    userVerification: params.userVerification ?? "required",
    timeout: params.timeoutMs,
  };

  const credential = (await navigator.credentials.get({
    publicKey: options,
  })) as PublicKeyCredential;

  const response = credential.response as AuthenticatorAssertionResponse;
  const selectedCredentialId = bytesToBase64Url(
    new Uint8Array(credential.rawId)
  );

  return {
    assertion: {
      credentialId: selectedCredentialId,
      clientDataJSON: bytesToBase64Url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: bytesToBase64Url(
        new Uint8Array(response.authenticatorData)
      ),
      signature: bytesToBase64Url(new Uint8Array(response.signature)),
      userHandle: response.userHandle
        ? bytesToBase64Url(new Uint8Array(response.userHandle))
        : null,
    },
    selectedCredentialId,
  };
}

export async function evaluatePrf(params: {
  credentialIdToSalt: Record<string, Uint8Array>;
  credentialTransports?: Record<string, AuthenticatorTransport[]>;
  userVerification?: UserVerificationRequirement;
  timeoutMs?: number;
}): Promise<{
  assertion: PublicKeyCredential;
  prfOutputs: Map<string, Uint8Array>;
  selectedCredentialId: string;
}> {
  if (!navigator.credentials?.get) {
    throw new Error("WebAuthn authentication is unavailable.");
  }

  assertUserActivation();

  const credentialIds = Object.keys(params.credentialIdToSalt);
  if (credentialIds.length === 0) {
    throw new Error("No passkeys available for PRF evaluation.");
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const allowCredentials = credentialIds.map((credentialId) => ({
    type: "public-key" as const,
    id: toArrayBuffer(base64UrlToBytes(credentialId)),
    transports: params.credentialTransports?.[credentialId],
  }));

  const evalByCredential: Record<string, { first: ArrayBuffer }> = {};
  for (const credentialId of credentialIds) {
    evalByCredential[credentialId] = {
      first: toArrayBuffer(params.credentialIdToSalt[credentialId]),
    };
  }
  const isSingle = credentialIds.length === 1;

  const options: PublicKeyCredentialRequestOptions = {
    challenge,
    allowCredentials,
    userVerification: params.userVerification ?? "required",
    timeout: params.timeoutMs,
    extensions: {
      prf: isSingle
        ? { eval: { first: evalByCredential[credentialIds[0]].first } }
        : { evalByCredential },
    },
  };

  const assertion = (await navigator.credentials.get({
    publicKey: options,
  })) as PublicKeyCredential;

  const selectedCredentialId = bytesToBase64Url(
    new Uint8Array(assertion.rawId)
  );

  const extensionResults = assertion.getClientExtensionResults() as
    | PrfExtensionResults
    | undefined;
  const outputs = new Map<string, Uint8Array>();
  const resultsByCredential = extensionResults?.prf?.resultsByCredential;
  if (resultsByCredential) {
    for (const [credentialId, output] of Object.entries(resultsByCredential)) {
      const parsed = toPrfOutput(output);
      if (parsed) {
        outputs.set(credentialId, parsed);
      }
    }
  }

  const singleOutput = toPrfOutput(extensionResults?.prf?.results?.first);
  if (singleOutput) {
    outputs.set(selectedCredentialId, singleOutput);
  }

  if (outputs.size === 0) {
    throw new Error("Authenticator did not return a PRF output.");
  }

  return {
    assertion,
    prfOutputs: outputs,
    selectedCredentialId,
  };
}
