"use client";

import "client-only";

import type { EnrollmentCredential } from "@/lib/privacy/secrets/catalog";

import { trpc } from "@/lib/trpc/client";

import {
  deriveBindingSecret,
  prepareBindingProofInputs,
} from "../zk/binding-secret";
import { AuthMode } from "../zk/proof-types";
import { generateBaseCommitment } from "../zk/prove";
import { getPreGeneratedKeys } from "./background-keygen";
import {
  persistFheKeyId,
  registerFheKeys,
  storeFheKeysWithCredential,
} from "./key-store";
import { generateFheKeyMaterialForStorage } from "./keygen-client";

function bindingSecretParams(credential: EnrollmentCredential) {
  const documentHash = "0x00";
  switch (credential.type) {
    case "passkey":
      return {
        authMode: AuthMode.PASSKEY,
        userId: credential.context.userId,
        documentHash,
        prfOutput: credential.context.prfOutput,
      };
    case "opaque":
      return {
        authMode: AuthMode.OPAQUE,
        userId: credential.context.userId,
        documentHash,
        exportKey: credential.context.exportKey,
      };
    case "wallet":
      return {
        authMode: AuthMode.WALLET,
        userId: credential.context.userId,
        documentHash,
        signatureBytes: credential.context.signatureBytes,
      };
    default: {
      const _exhaustive: never = credential;
      throw new Error("Unknown credential type");
    }
  }
}

export async function setFheEnrollmentComplete(keyId: string): Promise<void> {
  await trpc.identity.setFheStatus.mutate({
    fheKeyId: keyId,
    fheStatus: "complete",
  });
}

export async function enrollFheKeys(params: {
  credential: EnrollmentCredential;
  onStage: (stage: "generating" | "encrypting" | "registering") => void;
}): Promise<void> {
  const { credential, onStage } = params;

  onStage("generating");
  const preGenerated = await getPreGeneratedKeys();
  const material = preGenerated ?? (await generateFheKeyMaterialForStorage());
  const { storedKeys, publicKeyFingerprint: fingerprint } = material;

  const secretParams = await deriveBindingSecret(
    bindingSecretParams(credential)
  );
  const proofInputs = prepareBindingProofInputs(secretParams);
  const credentialBindingCommitment = await generateBaseCommitment(
    proofInputs.bindingSecretField,
    proofInputs.userIdHashField
  );

  onStage("encrypting");
  await storeFheKeysWithCredential({
    keys: storedKeys,
    credential,
    credentialBindingCommitment,
  });

  onStage("registering");
  const keyId = preGenerated
    ? preGenerated.keyId
    : await registerFheKeys(storedKeys);

  await persistFheKeyId(keyId, fingerprint);
  await setFheEnrollmentComplete(keyId);
}
