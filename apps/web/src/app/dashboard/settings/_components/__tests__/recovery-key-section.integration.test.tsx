// @vitest-environment jsdom

import type { VaultAccess } from "@/lib/privacy/secrets/vault-access";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const SPENT_NOTICE = /can't confirm an account recovery/i;
const REPLACE_LABEL = /replace recovery key/i;

vi.mock("@/components/vault-unlock", () => ({
  useVaultKeyPrompt: () => ({ dialog: null, requestVaultKey: vi.fn() }),
}));

vi.mock("@/lib/auth/passkey/client", () => ({
  withPasskeyConfirmation: vi.fn(),
}));

vi.mock("@/lib/privacy/secrets/vault", () => ({
  removeVaultCredential: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RecoveryKeySection } from "../recovery-key-section";

function access(confirmsRecovery: boolean): VaultAccess {
  return {
    passkeys: [],
    password: { connected: true },
    recoveryKey: { confirmsRecovery, createdAt: "2026-11-01T00:00:00.000Z" },
    secretId: "secret-1",
    unlockingCount: 2,
    wallet: null,
  };
}

describe("RecoveryKeySection", () => {
  it("asks to replace a recovery key that can no longer confirm a recovery", () => {
    render(<RecoveryKeySection access={access(false)} />);

    expect(screen.getByText(SPENT_NOTICE)).toBeTruthy();
    expect(screen.getByRole("button", { name: REPLACE_LABEL })).toBeTruthy();
  });

  it("says nothing more about a key that can confirm a recovery", () => {
    render(<RecoveryKeySection access={access(true)} />);

    expect(screen.queryByText(SPENT_NOTICE)).toBeNull();
  });
});
