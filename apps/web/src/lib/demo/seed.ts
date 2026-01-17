import crypto from "node:crypto";

import { db } from "@/lib/db/connection";
import { deleteIdentityData } from "@/lib/db/queries/identity";
import {
  encryptedAttributes,
  signedClaims,
  zkProofs,
} from "@/lib/db/schema/crypto";
import { identityBundles, identityDocuments } from "@/lib/db/schema/identity";

const DEMO_POLICY_VERSION = "demo-v1";
const DEMO_ISSUER_ID = "zentity-demo";

interface SeedResult {
  userId: string;
  documentId: string;
  policyVersion: string;
}

function nowIso() {
  return new Date().toISOString();
}

function makeDocHash() {
  return `doc_${crypto.randomUUID().replaceAll("-", "")}`;
}

function makeCommitment(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function seedDemoIdentity(userId: string): Promise<SeedResult> {
  await deleteIdentityData(userId);

  const createdAt = nowIso();
  const documentId = crypto.randomUUID();
  const docHash = makeDocHash();
  const nameCommitment = makeCommitment("name");
  const attestationExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  await db.transaction(async (tx) => {
    await tx
      .insert(identityBundles)
      .values({
        userId,
        status: "verified",
        policyVersion: DEMO_POLICY_VERSION,
        issuerId: DEMO_ISSUER_ID,
        attestationExpiresAt,
        fheStatus: "complete",
        fheKeyId: "demo-key",
        createdAt,
        updatedAt: createdAt,
      })
      .run();

    await tx
      .insert(identityDocuments)
      .values({
        id: documentId,
        userId,
        documentType: "passport",
        issuerCountry: "USA",
        documentHash: docHash,
        nameCommitment,
        verifiedAt: createdAt,
        confidenceScore: 0.99,
        status: "verified",
        createdAt,
        updatedAt: createdAt,
      })
      .run();

    await tx
      .insert(signedClaims)
      .values([
        {
          id: crypto.randomUUID(),
          userId,
          documentId,
          claimType: "liveness_score",
          claimPayload: JSON.stringify({
            type: "liveness_score",
            userId,
            issuedAt: createdAt,
            version: 1,
            data: {
              passed: true,
              antispoofScore: 0.98,
              liveScore: 0.97,
            },
          }),
          signature: "demo-signature",
          issuedAt: createdAt,
          createdAt,
        },
        {
          id: crypto.randomUUID(),
          userId,
          documentId,
          claimType: "face_match_score",
          claimPayload: JSON.stringify({
            type: "face_match_score",
            userId,
            issuedAt: createdAt,
            version: 1,
            data: {
              passed: true,
              confidence: 0.93,
            },
          }),
          signature: "demo-signature",
          issuedAt: createdAt,
          createdAt,
        },
      ])
      .run();

    const proofTypes = [
      "age_verification",
      "doc_validity",
      "nationality_membership",
      "face_match",
    ];

    await tx
      .insert(zkProofs)
      .values(
        proofTypes.map((proofType, index) => ({
          id: crypto.randomUUID(),
          userId,
          documentId,
          proofType,
          proofHash: `proof_${crypto.randomUUID().replaceAll("-", "")}`,
          proofPayload: "demo-proof",
          publicInputs: JSON.stringify([
            `${new Date().getFullYear()}`,
            "18",
            crypto.randomUUID(),
            String(index + 1),
          ]),
          isOver18: proofType === "age_verification" ? true : null,
          generationTimeMs: 1200 + index * 50,
          nonce: crypto.randomUUID(),
          policyVersion: DEMO_POLICY_VERSION,
          circuitType: proofType,
          verified: true,
          createdAt,
        }))
      )
      .run();

    await tx
      .insert(encryptedAttributes)
      .values({
        id: crypto.randomUUID(),
        userId,
        source: "demo_seed",
        attributeType: "birth_year_offset",
        ciphertext: Buffer.from("demo-ciphertext"),
        keyId: "demo-key",
        encryptionTimeMs: 42,
        createdAt,
      })
      .run();
  });

  return {
    userId,
    documentId,
    policyVersion: DEMO_POLICY_VERSION,
  };
}
