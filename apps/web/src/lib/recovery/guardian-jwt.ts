import "server-only";

import { SignJWT } from "jose";

import { env } from "@/env";
import { getOrCreateSigningKey } from "@/lib/auth/oidc/jwt-signer";

const GUARDIAN_JWT_TTL_SECONDS = 300; // 5 minutes (signing happens immediately)
const GUARDIAN_JWT_SCOPE = "frost:sign";

export async function signGuardianAssertionJwt(params: {
  challengeId: string;
  frostSessionId: string;
  guardianId: string;
  participantIndex: number;
  userId: string;
}): Promise<string> {
  const { kid, privateKey } = await getOrCreateSigningKey("EdDSA");
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    scope: GUARDIAN_JWT_SCOPE,
    session_id: params.frostSessionId,
    challenge_id: params.challengeId,
    guardian_id: params.guardianId,
    participant_id: params.participantIndex,
  })
    .setProtectedHeader({ alg: "EdDSA", kid })
    .setSubject(params.userId)
    .setIssuer(env.NEXT_PUBLIC_APP_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + GUARDIAN_JWT_TTL_SECONDS)
    .sign(privateKey);
}
