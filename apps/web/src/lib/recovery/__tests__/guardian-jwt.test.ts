import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";

import { signGuardianAssertionJwt } from "@/lib/recovery/guardian-jwt";

describe("signGuardianAssertionJwt", () => {
  it("sets session_id to frostSessionId, not challengeId", async () => {
    const jwt = await signGuardianAssertionJwt({
      frostSessionId: "frost-session-abc",
      challengeId: "challenge-xyz",
      guardianId: "guardian-1",
      participantIndex: 1,
      userId: "user-1",
    });

    const payload = decodeJwt(jwt);
    expect(payload.session_id).toBe("frost-session-abc");
    expect(payload.challenge_id).toBe("challenge-xyz");
    expect(payload.guardian_id).toBe("guardian-1");
    expect(payload.participant_id).toBe(1);
    expect(payload.sub).toBe("user-1");
    expect(payload.scope).toBe("frost:sign");
  });

  it("includes both session_id and challenge_id claims", async () => {
    const jwt = await signGuardianAssertionJwt({
      frostSessionId: "session-123",
      challengeId: "challenge-456",
      guardianId: "g-2",
      participantIndex: 2,
      userId: "u-2",
    });

    const payload = decodeJwt(jwt);
    // session_id must differ from challenge_id
    expect(payload.session_id).not.toBe(payload.challenge_id);
    expect(payload.session_id).toBe("session-123");
    expect(payload.challenge_id).toBe("challenge-456");
  });
});
