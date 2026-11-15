import type { VaultCredentialMaterial } from "../vault";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { bytesToBase64 } from "@/lib/privacy/primitives/symmetric";

interface StoredWrapper {
  credentialId: string;
  kekSource?: string;
  prfSalt?: string | null;
  wrappedDek: string;
}

const state = vi.hoisted(() => ({
  wrappers: [] as StoredWrapper[],
  added: [] as StoredWrapper[],
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    secrets: {
      getSecretBundle: {
        query: () =>
          Promise.resolve({
            secret: {
              id: SECRET_ID,
              blobHash: null,
              blobRef: null,
              metadata: null,
            },
            wrappers: state.wrappers,
          }),
      },
      addWrapper: {
        mutate: (input: StoredWrapper) => {
          state.added.push(input);
          return Promise.resolve({ success: true });
        },
      },
    },
  },
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { getSession: () => Promise.resolve({ data: null }) },
}));

import { addVaultCredential, unlockVaultKey } from "../vault";

const USER_ID = "vector-user";
const SECRET_ID = "vector-secret";

function fill(length: number, start: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (start + i) % 256);
}

const VAULT_KEY = fill(32, 0);

const MATERIALS: Record<
  VaultCredentialMaterial["type"],
  VaultCredentialMaterial
> = {
  passkey: {
    type: "passkey",
    credentialId: "vector-passkey",
    prfOutput: fill(32, 0x40),
    prfSalt: fill(32, 0x80),
  },
  opaque: { type: "opaque", exportKey: fill(64, 0x10) },
  wallet: {
    type: "wallet",
    address: "0x00000000000000000000000000000000000000aa",
    chainId: 11_155_111,
    signatureBytes: fill(65, 0x20),
  },
  recovery_key: { type: "recovery_key", recoveryKey: fill(32, 0xc0) },
};

const CREDENTIAL_IDS: Record<VaultCredentialMaterial["type"], string> = {
  passkey: "vector-passkey",
  opaque: "opaque",
  wallet: "wallet:11155111:0x00000000000000000000000000000000000000aa",
  recovery_key: "recovery_key",
};

const KEK_SOURCES: Record<VaultCredentialMaterial["type"], string> = {
  passkey: "prf",
  opaque: "opaque",
  wallet: "wallet",
  recovery_key: "recovery_key",
};

// Wrapped vault keys produced for MATERIALS by the per-credential wrap
// modules this vault replaced. Stored wrappers must keep unwrapping.
const STORED_WRAPPED_DEKS: Record<VaultCredentialMaterial["type"], string> = {
  passkey:
    '{"alg":"AES-GCM","iv":"z8uPbCubbH5JS9sL","ciphertext":"3E46attV3u27z+Xk3otmKZRzwIfOLzYEPB114HUZIYTf0dMUEyaNkYLCF+APtPi5"}',
  opaque:
    '{"alg":"AES-GCM","iv":"bRlUzXXDLc3JOJdk","ciphertext":"OjO5v6aXDFeUBKpwJFYmRfoYcb3/Jrfz3Zn2fZqUI5Z4KAZ7uyj+Kgez0ebJhoD2"}',
  wallet:
    '{"alg":"AES-GCM","iv":"LJTvvtpmIpPSo08Y","ciphertext":"tNsWHAAdJbPPSXM188MfP/31Br2NLIkNChE+5TTbuSNWxxBohd1AJqZiMrMq4q18"}',
  recovery_key:
    '{"alg":"AES-GCM","iv":"aWSzBv7VxpBJoXIz","ciphertext":"uyrsfQHLosM9moGtops5lgE0IrqnyyM5LJ59lHfhFcUUSZSbqR2HWtp5OEywiojB"}',
};

const MISMATCH = /can't open your encrypted data|doesn't match your account/;

const TYPES = Object.keys(MATERIALS) as VaultCredentialMaterial["type"][];

function flipFirstByte(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[0] = (copy[0] ?? 0) === 0 ? 1 : 0;
  return copy;
}

function withWrongBytes(
  material: VaultCredentialMaterial
): VaultCredentialMaterial {
  switch (material.type) {
    case "passkey":
      return { ...material, prfOutput: flipFirstByte(material.prfOutput) };
    case "opaque":
      return { ...material, exportKey: flipFirstByte(material.exportKey) };
    case "wallet":
      return {
        ...material,
        signatureBytes: flipFirstByte(material.signatureBytes),
      };
    case "recovery_key":
      return { ...material, recoveryKey: flipFirstByte(material.recoveryKey) };
    default:
      throw new Error("Unknown credential type");
  }
}

describe("vault credential wrapping", () => {
  beforeEach(() => {
    state.wrappers = [];
    state.added = [];
  });

  it.each(TYPES)("unwraps a stored %s wrapper", async (type) => {
    state.wrappers = [
      {
        credentialId: CREDENTIAL_IDS[type],
        prfSalt: type === "passkey" ? bytesToBase64(fill(32, 0x80)) : undefined,
        wrappedDek: STORED_WRAPPED_DEKS[type],
      },
    ];

    const vaultKey = await unlockVaultKey(MATERIALS[type], {
      userId: USER_ID,
    });

    expect(vaultKey).toEqual({
      key: VAULT_KEY,
      secretId: SECRET_ID,
      unlockedWith: CREDENTIAL_IDS[type],
      userId: USER_ID,
    });
  });

  it.each(TYPES)(
    "adds a %s wrapper that unlocks the vault key",
    async (type) => {
      await addVaultCredential(
        {
          key: VAULT_KEY,
          secretId: SECRET_ID,
          unlockedWith: "x",
          userId: USER_ID,
        },
        MATERIALS[type]
      );

      const [added] = state.added;
      expect(added).toMatchObject({
        credentialId: CREDENTIAL_IDS[type],
        kekSource: KEK_SOURCES[type],
      });
      expect(added?.prfSalt).toBe(
        type === "passkey" ? bytesToBase64(fill(32, 0x80)) : undefined
      );

      state.wrappers = state.added;
      const vaultKey = await unlockVaultKey(MATERIALS[type], {
        userId: USER_ID,
      });
      expect(vaultKey?.key).toEqual(VAULT_KEY);
    }
  );

  it.each(TYPES)("rejects the wrong %s material", async (type) => {
    state.wrappers = [
      {
        credentialId: CREDENTIAL_IDS[type],
        wrappedDek: STORED_WRAPPED_DEKS[type],
      },
    ];

    await expect(
      unlockVaultKey(withWrongBytes(MATERIALS[type]), { userId: USER_ID })
    ).rejects.toThrow(MISMATCH);
  });

  it.each(TYPES)("binds a %s wrapper to its user", async (type) => {
    state.wrappers = [
      {
        credentialId: CREDENTIAL_IDS[type],
        wrappedDek: STORED_WRAPPED_DEKS[type],
      },
    ];

    await expect(
      unlockVaultKey(MATERIALS[type], { userId: "another-user" })
    ).rejects.toThrow(MISMATCH);
  });

  it("refuses an OPAQUE export key of the wrong length", async () => {
    await expect(
      addVaultCredential(
        {
          key: VAULT_KEY,
          secretId: SECRET_ID,
          unlockedWith: "x",
          userId: USER_ID,
        },
        { type: "opaque", exportKey: fill(32, 0) }
      )
    ).rejects.toThrow("OPAQUE export key must be 64 bytes");
  });
});
