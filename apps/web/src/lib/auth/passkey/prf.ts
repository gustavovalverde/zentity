"use client";

import "client-only";

import { recordClientMetric } from "@/lib/observability/client-metrics";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  toArrayBuffer,
} from "@/lib/privacy/primitives/symmetric";

export interface PrfSupportStatus {
  reason?: string | undefined;
  supported: boolean;
}

const PRF_OUTPUT_LENGTH = 32;

interface PrfExtensionResults {
  prf?: {
    enabled?: boolean;
    results?: { first?: ArrayBuffer };
  };
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
  };
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
}): Uint8Array | null {
  if (
    !params.clientExtensionResults ||
    typeof params.clientExtensionResults !== "object"
  ) {
    return null;
  }

  const prf = (
    params.clientExtensionResults as {
      prf?: { results?: { first?: unknown } };
    }
  ).prf;

  if (!prf) {
    return null;
  }

  const candidate = prf.results?.first;

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

  // lib.dom declares getClientCapabilities, but older browsers lack it.
  if (!("getClientCapabilities" in PublicKeyCredential)) {
    return { supported: true };
  }

  try {
    const capabilities = await PublicKeyCredential.getClientCapabilities();
    if (capabilities["extension:prf"] === false) {
      return { supported: false, reason: "PRF extension not supported." };
    }
  } catch {
    // Unknown capabilities: let the PRF ceremony decide.
  }

  return { supported: true };
}

/**
 * The assertion the approval page posts with a CIBA decision. Extension
 * results are dropped, because the PRF output must never leave the browser.
 */
export interface ApprovalAssertion {
  authenticatorAttachment?: "cross-platform" | "platform";
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

function toAttachment(
  value: string | null | undefined
): ApprovalAssertion["authenticatorAttachment"] {
  return value === "platform" || value === "cross-platform" ? value : undefined;
}

/** Strips an assertion in WebAuthn JSON form down to what the server reads. */
export function toApprovalAssertion(json: {
  authenticatorAttachment?: string | null;
  id: string;
  rawId: string;
  response: ApprovalAssertion["response"];
}): ApprovalAssertion {
  const attachment = toAttachment(json.authenticatorAttachment);
  return {
    id: json.id,
    rawId: json.rawId,
    type: "public-key",
    ...(attachment ? { authenticatorAttachment: attachment } : {}),
    response: {
      authenticatorData: json.response.authenticatorData,
      clientDataJSON: json.response.clientDataJSON,
      signature: json.response.signature,
      ...(json.response.userHandle
        ? { userHandle: json.response.userHandle }
        : {}),
    },
    clientExtensionResults: {},
  };
}

/** Serializes a WebAuthn assertion credential for a CIBA decision. */
export function serializeApprovalAssertion(
  credential: PublicKeyCredential
): ApprovalAssertion {
  const response = credential.response as AuthenticatorAssertionResponse;
  const encode = (buffer: ArrayBuffer) =>
    bytesToBase64Url(new Uint8Array(buffer));
  return toApprovalAssertion({
    id: credential.id,
    rawId: encode(credential.rawId),
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      authenticatorData: encode(response.authenticatorData),
      clientDataJSON: encode(response.clientDataJSON),
      signature: encode(response.signature),
      ...(response.userHandle
        ? { userHandle: encode(response.userHandle) }
        : {}),
    },
  });
}

export async function evaluatePrf(params: {
  /** A server challenge, when the assertion also confirms a decision. */
  challenge?: Uint8Array | undefined;
  credentialIdToSalt: Record<string, Uint8Array>;
  userVerification?: UserVerificationRequirement | undefined;
  timeoutMs?: number | undefined;
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

  const challenge =
    params.challenge ?? crypto.getRandomValues(new Uint8Array(32));
  const allowCredentials: PublicKeyCredentialDescriptor[] = credentialIds.map(
    (credentialId) => ({
      type: "public-key",
      id: toArrayBuffer(base64UrlToBytes(credentialId)),
    })
  );

  const evalByCredential: Record<string, { first: ArrayBuffer }> = {};
  for (const credentialId of credentialIds) {
    const salt = params.credentialIdToSalt[credentialId];
    if (!salt) {
      continue;
    }
    evalByCredential[credentialId] = {
      first: toArrayBuffer(salt),
    };
  }
  const isSingle = credentialIds.length === 1;
  const singleEntry =
    isSingle && credentialIds[0]
      ? evalByCredential[credentialIds[0]]
      : undefined;

  const options: PublicKeyCredentialRequestOptions = {
    challenge: toArrayBuffer(challenge),
    allowCredentials,
    userVerification: params.userVerification ?? "required",
    ...(params.timeoutMs === undefined ? {} : { timeout: params.timeoutMs }),
    extensions: {
      prf: singleEntry
        ? { eval: { first: singleEntry.first } }
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
