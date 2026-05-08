import "server-only";

interface Evidence {
  ref: string | null;
  source: string;
}

/**
 * Sybil-resistance evidence resolver shared by OCR and NFC paths.
 *
 * Encodes the evidence-source ordering: a verified document/chip is the
 * stronger signal (`document_signal`); an active humanity credential is
 * a weaker but valid signal (`humanity_signal`); both together gives the
 * highest-confidence source value.
 *
 * `evidence_ref` is hint-only; it points at the strongest single artifact
 * available. With multiple humanity credentials, it picks the first id —
 * the unified per-RP humanity pseudonym (separate surface) is the
 * authoritative reference for downstream consumers.
 */
export function resolveSybilEvidence(args: {
  hasDocumentSybilSignal: boolean;
  humanityCredentialIds: readonly string[];
  verificationId: string;
}): Evidence {
  const hasHumanity = args.humanityCredentialIds.length > 0;
  const firstHumanityId = args.humanityCredentialIds[0] ?? null;

  if (args.hasDocumentSybilSignal && hasHumanity) {
    return { source: "document_and_humanity", ref: firstHumanityId };
  }
  if (args.hasDocumentSybilSignal) {
    return { source: "document_signal", ref: args.verificationId };
  }
  if (hasHumanity) {
    return { source: "humanity_signal", ref: firstHumanityId };
  }
  return { source: "none", ref: null };
}
