import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";

const REQUIRED_OCR_PROOF_TYPES = [
  "age_verification",
  "doc_validity",
  "nationality_membership",
  "face_match",
  "identity_binding",
] as const;

interface OcrProofRow {
  createdAt: string;
  policyVersion: string | null;
  proofSessionId: string | null;
  proofType: string;
}

export function hasRequiredOcrProofTypes(
  proofTypes: Iterable<string>
): boolean {
  const proofTypeSet =
    proofTypes instanceof Set ? proofTypes : new Set(proofTypes);

  return REQUIRED_OCR_PROOF_TYPES.every((proofType) =>
    proofTypeSet.has(proofType)
  );
}

export function selectLatestCompleteOcrProofRows<T extends OcrProofRow>(
  proofRows: readonly T[]
): T[] {
  const proofRowsBySession = new Map<
    string,
    { latestCreatedAt: string; proofTypes: Set<string>; rows: T[] }
  >();

  for (const row of proofRows) {
    if (!row.proofSessionId || row.policyVersion !== POLICY_VERSION) {
      continue;
    }

    const current = proofRowsBySession.get(row.proofSessionId);
    if (!current) {
      proofRowsBySession.set(row.proofSessionId, {
        latestCreatedAt: row.createdAt,
        proofTypes: new Set([row.proofType]),
        rows: [row],
      });
      continue;
    }

    current.rows.push(row);
    current.proofTypes.add(row.proofType);
    if (row.createdAt > current.latestCreatedAt) {
      current.latestCreatedAt = row.createdAt;
    }
  }

  let selectedSession: {
    latestCreatedAt: string;
    proofTypes: Set<string>;
    rows: T[];
  } | null = null;

  for (const session of proofRowsBySession.values()) {
    if (!hasRequiredOcrProofTypes(session.proofTypes)) {
      continue;
    }
    if (
      !selectedSession ||
      session.latestCreatedAt > selectedSession.latestCreatedAt
    ) {
      selectedSession = session;
    }
  }

  return selectedSession?.rows ?? [];
}
