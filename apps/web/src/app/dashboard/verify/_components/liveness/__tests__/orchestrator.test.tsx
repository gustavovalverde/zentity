// @vitest-environment jsdom

import type { ReactNode } from "react";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVerificationStore } from "@/lib/identity/verification/state";

import { LivenessOrchestrator } from "../orchestrator";

const COMPLETE_BUTTON = /Complete Verification/;
const SELFIE_DONE_BUTTON = "simulate selfie";
const DATE_ERROR =
  "Your device's date doesn't match ours. Set your date and time to update automatically, then try again.";

const mocks = vi.hoisted(() => ({
  finalize: vi.fn(),
  finalizeStatus: vi.fn(),
  generateAllProofs: vi.fn(),
  livenessStatus: vi.fn(),
  matchFace: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    info: vi.fn(),
    success: mocks.toastSuccess,
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    identity: {
      finalize: { mutate: mocks.finalize },
      finalizeStatus: { query: mocks.finalizeStatus },
      livenessStatus: { mutate: mocks.livenessStatus },
    },
    liveness: { matchFace: { mutate: mocks.matchFace } },
  },
}));

vi.mock("@/lib/identity/verification/finalize-and-prove", () => ({
  generateAllProofs: mocks.generateAllProofs,
}));

vi.mock("@/lib/identity/verification/profile-vault", () => ({
  buildProfileSecretDataFromOcrSnapshot: () => ({}),
  storeProfileSecretWithMaterial: () => Promise.resolve("stored"),
}));

vi.mock("@/lib/privacy/credentials/cache", () => ({
  getCachedBindingMaterial: () => ({ mode: "passkey" }),
  setCachedBindingMaterial: vi.fn(),
}));

vi.mock("@/lib/privacy/secrets/profile", () => ({
  assertProfileSecretStored: () => Promise.resolve(),
}));

vi.mock("@/lib/privacy/zk/binding-context", () => ({
  acquirePasskeyMaterial: vi.fn(),
  detectAuthMode: vi.fn(),
  getBindingContext: () =>
    Promise.resolve({ success: true, context: { userId: "user-1" } }),
}));

vi.mock("../../binding-auth-dialog", () => ({ BindingAuthDialog: () => null }));
vi.mock("../../face-verification-card", () => ({
  FaceVerificationCard: () => null,
}));
vi.mock("../flow", () => ({ LivenessFlow: () => null }));
vi.mock("../provider", () => ({
  LivenessProvider: ({
    children,
    onVerified,
  }: {
    children: ReactNode;
    onVerified: (result: {
      bestSelfieFrame: string;
      selfieImage: string;
    }) => void;
  }) => (
    <div>
      <button
        onClick={() =>
          onVerified({ bestSelfieFrame: "frame", selfieImage: "selfie" })
        }
        type="button"
      >
        {SELFIE_DONE_BUTTON}
      </button>
      {children}
    </div>
  ),
}));

async function renderMatchedOrchestrator(onComplete: () => void) {
  render(<LivenessOrchestrator onComplete={onComplete} wallet={null} />);
  fireEvent.click(screen.getByText(SELFIE_DONE_BUTTON));
  const button = screen.getByRole("button", { name: COMPLETE_BUTTON });
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false)
  );
  return button;
}

describe("LivenessOrchestrator retry after a failed proof step", () => {
  beforeEach(() => {
    useVerificationStore
      .getState()
      .set({ draftId: "draft-1", idDocumentBase64: "document" });
    mocks.matchFace.mockResolvedValue({
      confidence: 0.9,
      distance: 0.1,
      idFaceExtracted: true,
      matched: true,
      processingTimeMs: 1,
      threshold: 0.5,
    });
    // The finalize job deletes the draft once it verifies.
    mocks.livenessStatus
      .mockResolvedValueOnce({ issues: [], success: true })
      .mockResolvedValue({ issues: ["draft_not_found"], success: false });
    mocks.finalize.mockResolvedValue({ jobId: "job-1", status: "queued" });
    mocks.finalizeStatus.mockResolvedValue({
      jobId: "job-1",
      result: { verificationId: "ver-1", verified: true },
      status: "complete",
    });
    mocks.generateAllProofs
      .mockRejectedValueOnce(new Error(DATE_ERROR))
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    useVerificationStore.getState().reset();
  });

  it("generates proofs again for the finalized verification without finalizing twice", async () => {
    const onComplete = vi.fn();
    const button = await renderMatchedOrchestrator(onComplete);

    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Verification incomplete", {
        description: DATE_ERROR,
      })
    );
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false)
    );

    fireEvent.click(button);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    expect(mocks.generateAllProofs).toHaveBeenCalledTimes(2);
    expect(mocks.generateAllProofs).toHaveBeenLastCalledWith(
      expect.objectContaining({ verificationId: "ver-1" })
    );
    expect(mocks.finalize).toHaveBeenCalledTimes(1);
    expect(mocks.livenessStatus).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });
});
