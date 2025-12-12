"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  defaultWizardData,
  type WizardData,
} from "@/features/auth/schemas/sign-up.schema";
import { trackStep } from "@/lib/analytics";

const TOTAL_STEPS = 4;

/**
 * Server session state (returned from API)
 */
interface ServerSessionState {
  hasSession: boolean;
  email?: string;
  step?: number;
  documentProcessed?: boolean;
  livenessPassed?: boolean;
  faceMatchPassed?: boolean;
  hasPii?: boolean;
  hasExtractedName?: boolean;
  hasExtractedDOB?: boolean;
}

type WizardState = {
  currentStep: number;
  data: WizardData;
  isSubmitting: boolean;
  // Server-side verification flags
  serverState: {
    documentProcessed: boolean;
    livenessPassed: boolean;
    faceMatchPassed: boolean;
  };
};

type WizardAction =
  | { type: "NEXT_STEP" }
  | { type: "PREV_STEP" }
  | { type: "GO_TO_STEP"; step: number }
  | { type: "UPDATE_DATA"; data: Partial<WizardData> }
  | { type: "SET_SUBMITTING"; isSubmitting: boolean }
  | { type: "RESET" }
  | {
      type: "LOAD_STATE";
      state: {
        currentStep?: number;
        data?: Partial<WizardData>;
        serverState?: Partial<WizardState["serverState"]>;
      };
    }
  | {
      type: "UPDATE_SERVER_STATE";
      serverState: Partial<WizardState["serverState"]>;
    };

const initialState: WizardState = {
  currentStep: 1,
  data: defaultWizardData,
  isSubmitting: false,
  serverState: {
    documentProcessed: false,
    livenessPassed: false,
    faceMatchPassed: false,
  },
};

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "NEXT_STEP":
      return {
        ...state,
        currentStep: Math.min(state.currentStep + 1, TOTAL_STEPS),
      };
    case "PREV_STEP":
      return {
        ...state,
        currentStep: Math.max(state.currentStep - 1, 1),
      };
    case "GO_TO_STEP":
      return {
        ...state,
        currentStep: Math.max(1, Math.min(action.step, TOTAL_STEPS)),
      };
    case "UPDATE_DATA":
      return {
        ...state,
        data: { ...state.data, ...action.data },
      };
    case "SET_SUBMITTING":
      return {
        ...state,
        isSubmitting: action.isSubmitting,
      };
    case "RESET":
      return initialState;
    case "LOAD_STATE":
      return {
        ...state,
        currentStep: action.state.currentStep ?? state.currentStep,
        data: { ...state.data, ...(action.state.data ?? {}) },
        serverState: {
          ...state.serverState,
          ...(action.state.serverState ?? {}),
        },
      };
    case "UPDATE_SERVER_STATE":
      return {
        ...state,
        serverState: { ...state.serverState, ...action.serverState },
      };
    default:
      return state;
  }
}

type WizardContextType = {
  state: WizardState;
  totalSteps: number;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: number) => void;
  /** Navigate to step with server-side validation and confirmation for backward navigation */
  goToStepWithValidation: (step: number) => Promise<boolean>;
  updateData: (data: Partial<WizardData>) => void;
  setSubmitting: (isSubmitting: boolean) => void;
  reset: () => void;
  /** Start fresh session (clears any existing session) */
  startFresh: (email: string) => Promise<void>;
  /** Skip liveness verification and advance to next step */
  skipLiveness: () => Promise<boolean>;
  /** Save PII to server (encrypted) */
  savePiiToServer: (pii: {
    extractedName?: string;
    extractedDOB?: string;
    extractedDocNumber?: string;
    extractedNationality?: string;
  }) => Promise<void>;
  /** Update verification progress on server */
  updateServerProgress: (updates: {
    step?: number;
    documentProcessed?: boolean;
    livenessPassed?: boolean;
    faceMatchPassed?: boolean;
  }) => Promise<void>;
  canGoBack: boolean;
  canGoNext: boolean;
  isFirstStep: boolean;
  isLastStep: boolean;
  progress: number;
};

const WizardContext = createContext<WizardContextType | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const [isHydrated, setIsHydrated] = useState(false);
  const isInitializedRef = useRef(false);
  const lastSavedStepRef = useRef<number>(1);

  // Load session state from server on mount
  useEffect(() => {
    if (isHydrated) return;

    const loadServerSession = async () => {
      try {
        const response = await fetch("/api/onboarding/session");
        if (response.ok) {
          const serverState: ServerSessionState = await response.json();

          if (serverState.hasSession && serverState.email) {
            // Restore state from server
            dispatch({
              type: "LOAD_STATE",
              state: {
                currentStep: serverState.step ?? 1,
                data: {
                  email: serverState.email,
                },
                serverState: {
                  documentProcessed: serverState.documentProcessed ?? false,
                  livenessPassed: serverState.livenessPassed ?? false,
                  faceMatchPassed: serverState.faceMatchPassed ?? false,
                },
              },
            });
            lastSavedStepRef.current = serverState.step ?? 1;
          }
        }
      } catch {
        // Server session not available, start fresh
      }

      isInitializedRef.current = true;
      setIsHydrated(true);
    };

    loadServerSession();
  }, [isHydrated]);

  // Save step changes to server (debounced)
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (!state.data.email) return;
    if (state.currentStep === lastSavedStepRef.current) return;

    const saveStep = async () => {
      try {
        await fetch("/api/onboarding/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: state.data.email,
            step: state.currentStep,
          }),
        });
        lastSavedStepRef.current = state.currentStep;
      } catch {
        // Ignore save errors
      }
    };

    // Debounce to avoid excessive API calls
    const timeout = setTimeout(saveStep, 500);
    return () => clearTimeout(timeout);
  }, [state.currentStep, state.data.email]);

  // Save PII to server (encrypted)
  const savePiiToServer = useCallback(
    async (pii: {
      extractedName?: string;
      extractedDOB?: string;
      extractedDocNumber?: string;
      extractedNationality?: string;
    }) => {
      if (!state.data.email) return;

      try {
        await fetch("/api/onboarding/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: state.data.email,
            step: state.currentStep,
            pii,
          }),
        });
      } catch {}
    },
    [state.data.email, state.currentStep],
  );

  // Update verification progress on server
  const updateServerProgress = useCallback(
    async (updates: {
      step?: number;
      documentProcessed?: boolean;
      livenessPassed?: boolean;
      faceMatchPassed?: boolean;
    }) => {
      if (!state.data.email) return;

      try {
        await fetch("/api/onboarding/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: state.data.email,
            ...updates,
          }),
        });

        // Update local server state
        dispatch({
          type: "UPDATE_SERVER_STATE",
          serverState: {
            documentProcessed: updates.documentProcessed,
            livenessPassed: updates.livenessPassed,
            faceMatchPassed: updates.faceMatchPassed,
          },
        });
      } catch {}
    },
    [state.data.email],
  );

  const nextStep = () => dispatch({ type: "NEXT_STEP" });
  const prevStep = () => dispatch({ type: "PREV_STEP" });
  const goToStep = (step: number) => dispatch({ type: "GO_TO_STEP", step });
  const updateData = (data: Partial<WizardData>) =>
    dispatch({ type: "UPDATE_DATA", data });
  const setSubmitting = (isSubmitting: boolean) =>
    dispatch({ type: "SET_SUBMITTING", isSubmitting });

  const reset = useCallback(async () => {
    dispatch({ type: "RESET" });

    // Clear server session
    try {
      await fetch("/api/onboarding/session", { method: "DELETE" });
    } catch {
      // Ignore errors
    }
  }, []);

  // Start fresh session (clears any existing session to prevent session bleeding)
  const startFresh = useCallback(async (email: string) => {
    // Reset local state first
    dispatch({ type: "RESET" });

    // Create new session with forceNew flag (clears any existing session)
    try {
      const response = await fetch("/api/onboarding/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          step: 1,
          forceNew: true, // SECURITY: Clear any existing session
        }),
      });

      if (response.ok) {
        dispatch({
          type: "LOAD_STATE",
          state: {
            currentStep: 1,
            data: { email },
            serverState: {
              documentProcessed: false,
              livenessPassed: false,
              faceMatchPassed: false,
            },
          },
        });
        lastSavedStepRef.current = 1;
      }
    } catch {}
  }, []);

  // Skip liveness verification
  const skipLiveness = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/onboarding/skip-liveness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || "Cannot skip liveness at this time");
        return false;
      }

      const data = await response.json();

      // Update local state
      dispatch({ type: "GO_TO_STEP", step: data.newStep });
      lastSavedStepRef.current = data.newStep;

      return true;
    } catch {
      toast.error("Failed to skip liveness");
      return false;
    }
  }, []);

  // Navigate to step with server-side validation
  const goToStepWithValidation = useCallback(
    async (targetStep: number): Promise<boolean> => {
      // Validate on server
      try {
        const response = await fetch("/api/onboarding/validate-step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetStep }),
        });

        const data = await response.json();

        if (!response.ok || !data.valid) {
          toast.error(data.error || "Cannot navigate to this step");
          return false;
        }

        // If going backward, show warning and confirm
        if (data.requiresConfirmation && data.warning) {
          const confirmed = window.confirm(
            `${data.warning}\n\nAre you sure you want to go back?`,
          );

          if (!confirmed) {
            return false;
          }

          // Reset progress on server
          const resetResponse = await fetch("/api/onboarding/reset-to-step", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ step: targetStep }),
          });

          if (!resetResponse.ok) {
            const resetData = await resetResponse.json();
            toast.error(resetData.error || "Failed to reset progress");
            return false;
          }

          // Reset local server state for steps after target
          const resetServerState: Partial<WizardState["serverState"]> = {};
          if (targetStep <= 1) {
            resetServerState.documentProcessed = false;
            resetServerState.livenessPassed = false;
            resetServerState.faceMatchPassed = false;
          } else if (targetStep <= 2) {
            resetServerState.livenessPassed = false;
            resetServerState.faceMatchPassed = false;
          }

          dispatch({
            type: "UPDATE_SERVER_STATE",
            serverState: resetServerState,
          });
        }

        // Navigate to the step
        dispatch({ type: "GO_TO_STEP", step: targetStep });
        lastSavedStepRef.current = targetStep;

        return true;
      } catch {
        toast.error("Failed to validate step");
        return false;
      }
    },
    [],
  );

  const value: WizardContextType = {
    state,
    totalSteps: TOTAL_STEPS,
    nextStep,
    prevStep,
    goToStep,
    goToStepWithValidation,
    updateData,
    setSubmitting,
    reset,
    startFresh,
    skipLiveness,
    savePiiToServer,
    updateServerProgress,
    canGoBack: state.currentStep > 1,
    canGoNext: state.currentStep < TOTAL_STEPS,
    isFirstStep: state.currentStep === 1,
    isLastStep: state.currentStep === TOTAL_STEPS,
    progress: (state.currentStep / TOTAL_STEPS) * 100,
  };

  // Track step changes after hydration to avoid server/client mismatch
  useEffect(() => {
    if (!isHydrated) return;
    trackStep(state.currentStep);
  }, [isHydrated, state.currentStep]);

  // Warn before navigation with unsaved data to prevent accidental data loss
  useEffect(() => {
    if (!isHydrated) return;

    // Check if user has entered meaningful data (in-memory only)
    const hasUnsavedData = Boolean(
      state.data.idDocument || state.data.selfieImage || state.data.password,
    );

    // Only warn if user is mid-process (not on first or last step with completion)
    const isInProgress =
      state.currentStep > 1 && state.currentStep < TOTAL_STEPS;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedData && isInProgress) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isHydrated, state.currentStep, state.data]);

  // Show loading state until hydrated to prevent hydration mismatch
  if (!isHydrated) {
    return (
      <WizardContext.Provider value={value}>
        <div className="flex items-center justify-center py-12">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </WizardContext.Provider>
    );
  }

  return (
    <WizardContext.Provider value={value}>{children}</WizardContext.Provider>
  );
}

export function useWizard() {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error("useWizard must be used within a WizardProvider");
  }
  return context;
}
