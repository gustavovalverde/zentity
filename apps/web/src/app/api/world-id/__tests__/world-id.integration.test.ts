import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildWorldIdRequest: vi.fn(),
  requireBrowserSession: vi.fn(),
  verifyWorldIdProof: vi.fn(),
}));

vi.mock("@/lib/auth/resource-auth", () => ({
  requireBrowserSession: mocks.requireBrowserSession,
}));

vi.mock("@/lib/identity/world-id", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/identity/world-id")>();
  return {
    ...actual,
    buildWorldIdRequest: mocks.buildWorldIdRequest,
    verifyWorldIdProof: mocks.verifyWorldIdProof,
  };
});

import {
  attachHumanSignal,
  getActiveHumanSignal,
  getIdentityBundleByUserId,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

import { POST as attachWorldId } from "../attach/route";
import { POST as detachWorldId } from "../detach/route";
import { POST as createWorldIdRpContext } from "../rp-context/route";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const ACTION = "zentity-link-human-signal";

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/world-id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function makeUniquenessProof(nonce: string) {
  return {
    protocol_version: "3.0",
    nonce,
    action: ACTION,
    responses: [
      {
        identifier: "orb",
        proof: "0xproof",
        merkle_root: "0xroot",
        nullifier: "0xnullifier-test",
      },
    ],
    environment: "production",
  };
}

describe("World ID human signal routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();
  });

  it("creates an RP context and attaches a verified World ID uniqueness proof", async () => {
    const userId = await createTestUser();
    mocks.requireBrowserSession.mockResolvedValue({
      ok: true,
      session: { user: { id: userId } },
    });
    mocks.buildWorldIdRequest.mockReturnValue({
      action: ACTION,
      appId: "app_test",
      environment: "production",
      provider: "world_id",
      rpContext: {
        rp_id: "rp_test",
        nonce: "nonce-test",
        created_at: 1_700_000_000,
        expires_at: 1_800_000_000,
        signature: "0xsig",
      },
    });
    mocks.verifyWorldIdProof.mockResolvedValue({
      nullifier: "0xnullifier-test",
    });

    const contextResponse = await createWorldIdRpContext(makeRequest());
    expect(contextResponse.status).toBe(200);
    const contextBody = (await contextResponse.json()) as {
      action: string;
      challengeId: string;
      rpContext: { nonce: string };
    };
    expect(contextBody.action).toBe(ACTION);
    expect(contextBody.challengeId).toEqual(expect.any(String));
    expect(contextBody.rpContext.nonce).toBe("nonce-test");

    const attachResponse = await attachWorldId(
      makeRequest({
        challengeId: contextBody.challengeId,
        idkitResult: makeUniquenessProof("nonce-test"),
      })
    );
    expect(attachResponse.status).toBe(200);

    const [signal, bundle] = await Promise.all([
      getActiveHumanSignal(userId, "world_id"),
      getIdentityBundleByUserId(userId),
    ]);
    expect(signal?.providerSubjectKind).toBe("nullifier");
    expect(signal?.providerSubjectHash).toMatch(SHA256_HEX_RE);
    expect(signal?.providerSubjectHash).not.toContain("0xnullifier-test");
    expect(bundle?.hasHumanSignal).toBe(true);
  });

  it("detaches the active World ID signal", async () => {
    const userId = await createTestUser();
    await upsertIdentityBundle({ userId });
    await attachHumanSignal({
      userId,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-detach-route",
    });
    mocks.requireBrowserSession.mockResolvedValue({
      ok: true,
      session: { user: { id: userId } },
    });

    const response = await detachWorldId(makeRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as { detached: boolean; ok: boolean };
    expect(body).toEqual({ ok: true, detached: true });

    const [signal, bundle] = await Promise.all([
      getActiveHumanSignal(userId, "world_id"),
      getIdentityBundleByUserId(userId),
    ]);
    expect(signal).toBeNull();
    expect(bundle?.hasHumanSignal).toBe(false);
  });
});
