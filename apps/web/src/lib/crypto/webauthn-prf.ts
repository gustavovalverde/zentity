"use client";

import "client-only";

import type { AuthenticationExtensionsClientInputs } from "@simplewebauthn/server";

import { recordClientMetric } from "@/lib/observability/client-metrics";
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

export function buildPrfExtension(
  prfSalt: Uint8Array
): AuthenticationExtensionsClientInputs {
  return {
    prf: {
      eval: {
        first: toArrayBuffer(prfSalt),
      },
    },
  } as AuthenticationExtensionsClientInputs;
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

export function extractPrfOutputFromClientResults(params: {
  clientExtensionResults: unknown;
  credentialId?: string;
}): Uint8Array | null {
  if (
    !params.clientExtensionResults ||
    typeof params.clientExtensionResults !== "object"
  ) {
    return null;
  }

  const prf = (
    params.clientExtensionResults as {
      prf?: {
        results?: { first?: unknown };
        resultsByCredential?: Record<string, unknown>;
      };
    }
  ).prf;

  if (!prf) {
    return null;
  }

  const candidate =
    prf.results?.first ??
    (params.credentialId
      ? prf.resultsByCredential?.[params.credentialId]
      : null);

  if (!candidate) {
    return null;
  }

  if (candidate instanceof ArrayBuffer) {
    return toPrfOutput(candidate);
  }
  if (candidate instanceof Uint8Array) {
    const bytes = new Uint8Array(candidate);
    return toPrfOutput(bytes.buffer);
  }
  if (typeof candidate === "string") {
    const bytes = base64UrlToBytes(candidate);
    if (bytes.byteLength !== PRF_OUTPUT_LENGTH) {
      throw new Error("Unexpected PRF output length.");
    }
    return bytes;
  }

  return null;
}

function getCredentialBucket(count: number): "1" | "2-3" | "4+" {
  if (count <= 1) {
    return "1";
  }
  if (count <= 3) {
    return "2-3";
  }
  return "4+";
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

/**
 * Extract registration data from a credential for server-side storage.
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
  const credentialBucket = getCredentialBucket(credentialIds.length);

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

  const start = performance.now();
  try {
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
      for (const [credentialId, output] of Object.entries(
        resultsByCredential
      )) {
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

    recordClientMetric({
      name: "client.passkey.duration",
      value: performance.now() - start,
      attributes: {
        operation: "prf",
        result: "ok",
        credential_bucket: credentialBucket,
      },
    });

    return {
      assertion,
      prfOutputs: outputs,
      selectedCredentialId,
    };
  } catch (error) {
    recordClientMetric({
      name: "client.passkey.duration",
      value: performance.now() - start,
      attributes: {
        operation: "prf",
        result: "error",
        credential_bucket: credentialBucket,
      },
    });
    throw error;
  }
}
