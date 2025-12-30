"use client";

import { base64UrlToBytes, bytesToBase64Url } from "@/lib/utils";

export interface PrfSupportStatus {
  supported: boolean;
  reason?: string;
}

const PRF_OUTPUT_LENGTH = 32;

type PrfExtensionResults = {
  prf?: {
    enabled?: boolean;
    results?: { first?: ArrayBuffer };
    resultsByCredential?: Record<string, ArrayBuffer>;
  };
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function assertUserActivation() {
  if (typeof navigator === "undefined" || !("userActivation" in navigator)) {
    return;
  }
  const activation = navigator.userActivation;
  if (!activation?.isActive && !activation?.hasBeenActive) {
    throw new Error("Passkey unlock must be triggered by a user gesture.");
  }
}

function toPrfOutput(output?: ArrayBuffer): Uint8Array | null {
  if (!output) return null;
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
  options: PublicKeyCredentialCreationOptions,
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

export async function evaluatePrf(params: {
  credentialIdToSalt: Record<string, Uint8Array>;
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
    new Uint8Array(assertion.rawId),
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
