import crypto from "node:crypto";

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return TRUTHY_VALUES.has(value.trim().toLowerCase());
}

export function isLivenessAttestationRequired(): boolean {
  return isTruthyEnv(process.env.LIVENESS_REQUIRE_ATTESTATION);
}

export function computeLivenessAttestationProof(
  sessionId: string,
  challenge: string,
  secret: string
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${sessionId}:${challenge}`)
    .digest("hex");
}

export function verifyLivenessAttestationProof(input: {
  sessionId: string;
  challenge: string;
  proof: string;
}): boolean {
  const secret = process.env.LIVENESS_ATTESTATION_SECRET ?? "";
  if (!secret) {
    return false;
  }
  const expected = computeLivenessAttestationProof(
    input.sessionId,
    input.challenge,
    secret
  );
  if (input.proof.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(input.proof),
    Buffer.from(expected)
  );
}
