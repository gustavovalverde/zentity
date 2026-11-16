import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The server: refuses both steps until the user confirms. */
const { deletePasskey, removeCredential, server } = vi.hoisted(() => {
  const server = {
    passkeys: new Set<string>(),
    reverified: false,
    wrappers: new Set<string>(),
  };
  const refused = Object.assign(new Error("Confirm it's you"), {
    data: { code: "FORBIDDEN", reason: "REVERIFICATION_REQUIRED" },
  });
  return {
    server,
    removeCredential: vi.fn(({ credentialId }: { credentialId: string }) => {
      if (!server.reverified) {
        return Promise.reject(refused);
      }
      server.wrappers.delete(credentialId);
      return Promise.resolve({ success: true });
    }),
    deletePasskey: vi.fn(({ id }: { id: string }) => {
      if (!server.reverified) {
        return Promise.resolve({
          data: null,
          error: { code: "REVERIFICATION_REQUIRED" },
        });
      }
      server.passkeys.delete(id);
      return Promise.resolve({ data: { status: true }, error: null });
    }),
  };
});

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    secrets: { removeCredential: { mutate: removeCredential } },
  },
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    getSession: () => Promise.resolve({ data: null }),
    passkey: { deletePasskey },
  },
}));

import {
  getPasskeyConfirmation,
  type PasskeyConfirmationChoice,
  subscribePasskeyConfirmation,
} from "@/lib/auth/passkey/client";

import { removePasskey } from "../vault";

const PASSKEY = { id: "passkey-1", credentialId: "credential-1" };

describe("removePasskey", () => {
  let unsubscribe: () => void = () => undefined;

  function answerWith(choice: PasskeyConfirmationChoice) {
    unsubscribe = subscribePasskeyConfirmation(() => {
      const request = getPasskeyConfirmation();
      if (request) {
        queueMicrotask(() => request.choose(choice));
      }
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    server.reverified = false;
    server.passkeys = new Set([PASSKEY.id]);
    server.wrappers = new Set([PASSKEY.credentialId]);
  });

  afterEach(() => {
    unsubscribe();
  });

  it("keeps the passkey able to open the vault when the confirmation is cancelled", async () => {
    answerWith("cancel");

    await expect(
      removePasskey({ ...PASSKEY, opensVault: true })
    ).rejects.toThrow("Nothing was changed.");

    expect(server.wrappers.has(PASSKEY.credentialId)).toBe(true);
    expect(server.passkeys.has(PASSKEY.id)).toBe(true);
    expect(deletePasskey).not.toHaveBeenCalled();
  });

  it("removes the wrapper, then the passkey, after one confirmation", async () => {
    server.reverified = true;

    await expect(
      removePasskey({ ...PASSKEY, opensVault: true })
    ).resolves.toMatchObject({ error: null });

    expect(server.wrappers.size).toBe(0);
    expect(server.passkeys.size).toBe(0);
    expect(removeCredential.mock.invocationCallOrder[0]).toBeLessThan(
      deletePasskey.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("leaves the vault alone for a passkey that does not open it", async () => {
    server.reverified = true;

    await removePasskey({ ...PASSKEY, opensVault: false });

    expect(removeCredential).not.toHaveBeenCalled();
    expect(server.passkeys.size).toBe(0);
  });
});
