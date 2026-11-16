import { eq, like } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth-config";
import {
  issuePasskeyStepUp,
  PasskeyStepUpError,
  verifyPasskeyStepUp,
} from "@/lib/auth/passkey/step-up";
import { db } from "@/lib/db/connection";
import { passkeys, verifications } from "@/lib/db/schema/auth";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

const REQUEST_ID = "request-a";
const SESSION_ID = "session-a";

async function store() {
  return (await auth.$context).internalAdapter;
}

describe("passkey step-up", () => {
  let userId: string;
  let authenticator: TestAuthenticator;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    authenticator = await new TestAuthenticator().register(userId);
  });

  async function issue(
    binding: { requestId?: string; sessionId?: string; userId?: string } = {}
  ) {
    const options = await issuePasskeyStepUp(await store(), {
      requestId: binding.requestId ?? REQUEST_ID,
      sessionId: binding.sessionId ?? SESSION_ID,
      userId: binding.userId ?? userId,
    });
    if (!options) {
      throw new Error("Expected step-up options");
    }
    return options;
  }

  async function verify(
    response: ReturnType<TestAuthenticator["assert"]>,
    binding: { requestId?: string; sessionId?: string; userId?: string } = {}
  ) {
    return verifyPasskeyStepUp(await store(), {
      requestId: binding.requestId ?? REQUEST_ID,
      sessionId: binding.sessionId ?? SESSION_ID,
      userId: binding.userId ?? userId,
      response,
    });
  }

  /** The step-up failure reason, or "verified" when it succeeds. */
  function outcome(promise: Promise<unknown>): Promise<string> {
    return promise.then(
      () => "verified",
      (caught: unknown) =>
        caught instanceof PasskeyStepUpError ? caught.reason : String(caught)
    );
  }

  it("offers the user's own passkeys and asks for user verification", async () => {
    const options = await issue();

    expect(options).toEqual(
      expect.objectContaining({
        rpId: "localhost",
        userVerification: "required",
        timeout: 120_000,
        allowCredentials: [
          expect.objectContaining({
            id: authenticator.credentialId,
            type: "public-key",
          }),
        ],
      })
    );
  });

  it("returns no options for a user without a passkey", async () => {
    const other = await createTestUser();

    expect(
      await issuePasskeyStepUp(await store(), {
        requestId: REQUEST_ID,
        sessionId: SESSION_ID,
        userId: other,
      })
    ).toBeNull();
  });

  it("verifies a user-verified assertion once and advances the counter", async () => {
    const { challenge } = await issue();
    const response = authenticator.assert({ challenge, counter: 7 });

    const result = await verify(response);

    expect(result).toEqual({
      passkeyId: authenticator.passkeyId,
      verifiedAt: expect.any(Date),
    });
    const row = await db
      .select({ counter: passkeys.counter })
      .from(passkeys)
      .where(eq(passkeys.id, authenticator.passkeyId))
      .get();
    expect(row?.counter).toBe(7);
    expect(await outcome(verify(response))).toBe("challenge_missing");
  });

  it("refuses an expired challenge", async () => {
    const { challenge } = await issue();
    await db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(like(verifications.identifier, "ciba-step-up:%"))
      .run();

    expect(await outcome(verify(authenticator.assert({ challenge })))).toBe(
      "challenge_missing"
    );
  });

  it("binds the challenge to one request and one session", async () => {
    const { challenge } = await issue();

    expect(
      await outcome(
        verify(authenticator.assert({ challenge }), { requestId: "request-b" })
      )
    ).toBe("challenge_missing");
    expect(
      await outcome(
        verify(authenticator.assert({ challenge }), { sessionId: "session-b" })
      )
    ).toBe("challenge_missing");
  });

  it("refuses another user's passkey", async () => {
    const other = await createTestUser();
    const otherAuthenticator = await new TestAuthenticator().register(other);
    const { challenge } = await issue();

    expect(
      await outcome(verify(otherAuthenticator.assert({ challenge })))
    ).toBe("verification_failed");
  });

  it("refuses an assertion without user verification", async () => {
    const { challenge } = await issue();

    expect(
      await outcome(
        verify(authenticator.assert({ challenge, userVerified: false }))
      )
    ).toBe("verification_failed");
  });

  it.each([
    ["relying party", { rpId: "evil.example" }],
    ["origin", { origin: "https://evil.example" }],
    ["ceremony type", { type: "webauthn.create" }],
  ])("refuses an assertion for another %s", async (_case, overrides) => {
    const { challenge } = await issue();

    expect(
      await outcome(verify(authenticator.assert({ challenge, ...overrides })))
    ).toBe("verification_failed");
  });

  it("refuses a signature counter that went backwards", async () => {
    const counted = await new TestAuthenticator().register(userId, 10);
    const { challenge } = await issue();

    expect(
      await outcome(verify(counted.assert({ challenge, counter: 9 })))
    ).toBe("verification_failed");
  });

  it("invalidates the previous challenge when new options are issued", async () => {
    const first = await issue();
    const second = await issue();

    expect(
      await outcome(
        verify(authenticator.assert({ challenge: first.challenge }))
      )
    ).toBe("verification_failed");
    // The failed attempt consumed the current challenge as well.
    expect(
      await outcome(
        verify(authenticator.assert({ challenge: second.challenge }))
      )
    ).toBe("challenge_missing");
  });
});
