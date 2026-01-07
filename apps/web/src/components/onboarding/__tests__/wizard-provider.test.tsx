// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const trpcMocks = vi.hoisted(() => ({
  getSession: vi.fn().mockResolvedValue({ hasSession: false }),
  saveSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
  clearSession: vi.fn().mockResolvedValue(undefined),
  validateStep: vi.fn().mockResolvedValue({
    valid: true,
    currentStep: 1,
    error: null,
    warning: null,
    requiresConfirmation: false,
  }),
  resetToStep: vi.fn().mockResolvedValue(undefined),
  skipLiveness: vi.fn().mockResolvedValue({ newStep: 4 }),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    onboarding: {
      getSession: { query: trpcMocks.getSession },
      saveSession: { mutate: trpcMocks.saveSession },
      clearSession: { mutate: trpcMocks.clearSession },
      validateStep: { mutate: trpcMocks.validateStep },
      resetToStep: { mutate: trpcMocks.resetToStep },
      skipLiveness: { mutate: trpcMocks.skipLiveness },
    },
  },
}));

vi.mock("@/lib/onboarding/wizard-storage", () => ({
  clearOnboardingDraft: vi.fn(),
  loadOnboardingDraft: vi.fn(() => null),
  saveOnboardingDraft: vi.fn(),
}));

vi.mock("@/lib/auth/session-manager", () => ({
  prepareForNewSession: vi.fn(),
}));

vi.mock("@/lib/observability/flow-client", () => ({
  setOnboardingFlowId: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/sign-up",
  useSearchParams: () => new URLSearchParams(""),
}));

import {
  useWizard,
  WizardProvider,
} from "@/components/onboarding/wizard-provider";
import { prepareForNewSession } from "@/lib/auth/session-manager";

function TriggerUpdate() {
  const { updateServerProgress } = useWizard();
  return (
    <button onClick={() => updateServerProgress({ step: 4 })} type="button">
      Update
    </button>
  );
}

describe("WizardProvider", () => {
  it("saves progress even when email is missing (anonymous flow)", async () => {
    render(
      <WizardProvider>
        <TriggerUpdate />
      </WizardProvider>
    );

    await waitFor(() => {
      expect(trpcMocks.getSession).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(trpcMocks.saveSession).toHaveBeenCalledWith({ step: 4 });
    });
  });

  it("clears local session state when forceReset is set", async () => {
    render(
      <WizardProvider forceReset>
        <TriggerUpdate />
      </WizardProvider>
    );

    await waitFor(() => {
      expect(trpcMocks.clearSession).toHaveBeenCalled();
    });

    expect(prepareForNewSession).toHaveBeenCalled();
  });
});
