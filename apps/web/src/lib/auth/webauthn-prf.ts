"use client";

import "client-only";

import type { AuthenticationExtensionsClientInputs } from "@simplewebauthn/server";

import { recordClientMetric } from "@/lib/observability/client-metrics";
import {
  base64UrlToBytes,
  bytesToBase64Url,
} from "@/lib/privacy/primitives/base64";

export interface PrfSupportStatus {
  reason?: string | undefined;
  supported: boolean;
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
  credentialId?: string | undefined;
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

export async function evaluatePrf(params: {
  credentialIdToSalt: Record<string, Uint8Array>;
  credentialTransports?: Record<string, AuthenticatorTransport[]> | undefined;
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

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const allowCredentials: PublicKeyCredentialDescriptor[] = credentialIds.map(
    (credentialId) => {
      const transports = params.credentialTransports?.[credentialId];
      return {
        type: "public-key" as const,
        id: toArrayBuffer(base64UrlToBytes(credentialId)),
        ...(transports === undefined ? {} : { transports }),
      };
    }
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
    challenge,
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
