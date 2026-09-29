"use client";

import "client-only";

import type { EnrollmentCredential } from "@/lib/privacy/secrets/catalog";

import { trpc } from "@/lib/trpc/client";

import { registerCredentialBinding } from "../zk/binding-context";
import { getPreGeneratedKeys } from "./background-keygen";
import {
  persistFheKeyId,
  registerFheKeys,
  storeFheKeysWithCredential,
} from "./key-store";
import { generateFheKeyMaterialForStorage } from "./keygen-client";

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

  onStage("encrypting");
  const { secretId } = await storeFheKeysWithCredential({
    keys: storedKeys,
    credential,
  });
  await registerCredentialBinding({ secretId, credential });

  onStage("registering");
  const keyId = preGenerated
    ? preGenerated.keyId
    : await registerFheKeys(storedKeys);

  await persistFheKeyId(keyId, fingerprint);
  await setFheEnrollmentComplete(keyId);
}
