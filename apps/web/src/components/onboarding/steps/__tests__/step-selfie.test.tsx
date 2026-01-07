// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const CONTINUE_LABEL = /continue/i;

const wizardMocks = vi.hoisted(() => ({
  state: {
    data: {
      selfieImage: "selfie",
      bestSelfieFrame: "selfie",
      idDocumentBase64: "document",
      identityDraftId: "draft-1",
    },
    isSubmitting: false,
  },
  updateData: vi.fn(),
  nextStep: vi.fn(),
  prevStep: vi.fn(),
  skipLiveness: vi.fn().mockResolvedValue(true),
  reset: vi.fn(),
  setSubmitting: vi.fn(),
  updateServerProgress: vi.fn().mockResolvedValue(undefined),
  canGoBack: true,
  isLastStep: false,
}));

vi.mock("@/components/onboarding/wizard-provider", () => ({
  useWizard: () => wizardMocks,
}));

const trpcMocks = vi.hoisted(() => ({
  prepareLiveness: vi.fn().mockResolvedValue({
    livenessPassed: true,
    faceMatchPassed: true,
  }),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    identity: {
      prepareLiveness: {
        mutate: trpcMocks.prepareLiveness,
      },
    },
  },
}));

const cameraMocks = vi.hoisted(() => ({
  videoRef: { current: null },
  isStreaming: false,
  permissionStatus: "granted",
  startCamera: vi.fn(),
  stopCamera: vi.fn(),
  captureFrame: vi.fn().mockReturnValue("frame"),
  captureStreamFrame: vi.fn().mockReturnValue("frame"),
  getSquareDetectionCanvas: vi.fn(),
}));

vi.mock("@/hooks/use-liveness-camera", () => ({
  useLivenessCamera: () => cameraMocks,
}));

vi.mock("@/hooks/use-human-liveness", () => ({
  useHumanLiveness: () => ({ human: null, ready: true, error: null }),
}));

const selfieFlowMocks = vi.hoisted(() => ({
  challengeState: "all_passed",
  challengeImage: null,
  currentChallenge: null,
  completedChallenges: [],
  detectionProgress: 0,
  challengeProgress: 0,
  countdown: 0,
  statusMessage: "",
  serverProgress: null,
  serverHint: null,
  debugCanvasRef: { current: null },
  debugFrame: null,
  lastVerifyError: null,
  lastVerifyResponse: null,
  beginCamera: vi.fn(),
  retryChallenge: vi.fn(),
}));

vi.mock("@/hooks/liveness/use-selfie-liveness-flow", () => ({
  useSelfieLivenessFlow: () => selfieFlowMocks,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { StepSelfie } from "@/components/onboarding/steps/step-selfie";

describe("StepSelfie", () => {
  it("advances server session to step 4 after liveness success", async () => {
    render(<StepSelfie />);

    fireEvent.click(screen.getByRole("button", { name: CONTINUE_LABEL }));

    await waitFor(() => {
      expect(trpcMocks.prepareLiveness).toHaveBeenCalled();
      expect(wizardMocks.updateServerProgress).toHaveBeenCalledWith({
        livenessPassed: true,
        faceMatchPassed: true,
        step: 4,
      });
      expect(wizardMocks.nextStep).toHaveBeenCalled();
    });
  });
});
