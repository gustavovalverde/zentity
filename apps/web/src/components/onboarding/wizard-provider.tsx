/**
 * Onboarding Wizard Provider
 *
 * Manages the multi-step KYC wizard state using React Context + Reducer.
 * Syncs state with server-side onboarding session for persistence.
 *
 * Steps:
 * 1. Account creation (email/password collected in step 4)
 * 2. Document upload + OCR verification
 * 3. Liveness detection (optional, can be skipped)
 * 4. Review & complete (password, account creation, ZK proof generation)
 *
 * Features:
 * - Server-side state persistence via encrypted cookies
 * - Navigation validation (forward requires prerequisites, backward warns)
 * - PII stored encrypted in session, never in plain text
 * - beforeunload warning for unsaved progress
 */
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
import { trpc } from "@/lib/trpc/client";

const TOTAL_STEPS = 4;
type WizardStep = 1 | 2 | 3 | 4;

/** Clamps step number to valid range [1, TOTAL_STEPS]. */
function toWizardStep(step: number): WizardStep {
  return Math.max(1, Math.min(step, TOTAL_STEPS)) as WizardStep;
}

/**
 * Server session state (returned from API)
 */
interface ServerSessionState {
  hasSession: boolean;
  /** True if a stale session cookie was just cleared (session expired or DB mismatch) */
  wasCleared?: boolean;
  email?: string;
  step?: WizardStep;
  documentProcessed?: boolean;
  livenessPassed?: boolean;
  faceMatchPassed?: boolean;
  hasPii?: boolean;
  hasExtractedName?: boolean;
  hasExtractedDOB?: boolean;
}

type WizardState = {
  currentStep: WizardStep;
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
        currentStep?: WizardStep;
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

/** Pure reducer for wizard state transitions. */
function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "NEXT_STEP":
      return {
        ...state,
        currentStep: toWizardStep(state.currentStep + 1),
      };
    case "PREV_STEP":
      return {
        ...state,
        currentStep: toWizardStep(state.currentStep - 1),
      };
    case "GO_TO_STEP":
      return {
        ...state,
        currentStep: toWizardStep(action.step),
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
  /** Pending back-navigation confirmation request (set when going to a previous completed step). */
  pendingNavigation: { targetStep: WizardStep; warning: string } | null;
  /** Confirm and execute a pending back-navigation (resets server progress). */
  confirmPendingNavigation: () => Promise<boolean>;
  /** Cancel a pending back-navigation confirmation. */
  cancelPendingNavigation: () => void;
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
    step?: WizardStep;
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
  const lastSavedStepRef = useRef<WizardStep>(1);
  const [pendingNavigation, setPendingNavigation] = useState<{
    targetStep: WizardStep;
    warning: string;
  } | null>(null);

  // Load session state from server on mount
  useEffect(() => {
    if (isHydrated) return;

    const loadServerSession = async () => {
      try {
        const serverState = (await trpc.onboarding.getSession.query()) as
          | ServerSessionState
          | undefined;

        if (serverState?.hasSession && serverState.email) {
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
        } else if (serverState?.wasCleared) {
          // Session was cleared due to expiration or mismatch - notify user
          toast.info("Session expired. Please start again.");
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
        await trpc.onboarding.saveSession.mutate({
          email: state.data.email,
          step: state.currentStep,
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
        await trpc.onboarding.saveSession.mutate({
          email: state.data.email,
          step: state.currentStep,
          pii,
        });
      } catch {}
    },
    [state.data.email, state.currentStep],
  );

  // Update verification progress on server
  const updateServerProgress = useCallback(
    async (updates: {
      step?: WizardStep;
      documentProcessed?: boolean;
      livenessPassed?: boolean;
      faceMatchPassed?: boolean;
    }) => {
      if (!state.data.email) return;

      try {
        await trpc.onboarding.saveSession.mutate({
          email: state.data.email,
          ...updates,
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
      await trpc.onboarding.clearSession.mutate();
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
      await trpc.onboarding.saveSession.mutate({
        email,
        step: 1,
        forceNew: true,
      });

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
    } catch {}
  }, []);

  // Skip liveness verification
  const skipLiveness = useCallback(async (): Promise<boolean> => {
    try {
      const data = await trpc.onboarding.skipLiveness.mutate();
      const newStep = toWizardStep(data.newStep);

      // Update local state
      dispatch({ type: "GO_TO_STEP", step: newStep });
      lastSavedStepRef.current = newStep;

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
        const normalizedTargetStep = toWizardStep(targetStep);
        const data = await trpc.onboarding.validateStep.mutate({
          targetStep: normalizedTargetStep,
        });

        if (!data.valid) {
          toast.error(data.error || "Cannot navigate to this step");
          return false;
        }

        // If going backward, request confirmation via UI (Dialog).
        if (data.requiresConfirmation && data.warning) {
          setPendingNavigation({
            targetStep: normalizedTargetStep,
            warning: data.warning,
          });
          return false;
        }

        // Navigate to the step
        dispatch({ type: "GO_TO_STEP", step: normalizedTargetStep });
        lastSavedStepRef.current = normalizedTargetStep;

        return true;
      } catch {
        toast.error("Failed to validate step");
        return false;
      }
    },
    [],
  );

  const cancelPendingNavigation = useCallback(() => {
    setPendingNavigation(null);
  }, []);

  const confirmPendingNavigation = useCallback(async (): Promise<boolean> => {
    if (!pendingNavigation) return false;

    const targetStep = pendingNavigation.targetStep;
    try {
      await trpc.onboarding.resetToStep.mutate({ step: targetStep });

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

      dispatch({ type: "GO_TO_STEP", step: targetStep });
      lastSavedStepRef.current = targetStep;
      setPendingNavigation(null);
      return true;
    } catch {
      toast.error("Failed to reset progress");
      return false;
    }
  }, [pendingNavigation]);

  const value: WizardContextType = {
    state,
    totalSteps: TOTAL_STEPS,
    nextStep,
    prevStep,
    goToStep,
    goToStepWithValidation,
    pendingNavigation,
    confirmPendingNavigation,
    cancelPendingNavigation,
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

/** Hook to access wizard state and actions. Must be used within WizardProvider. */
export function useWizard() {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error("useWizard must be used within a WizardProvider");
  }
  return context;
}
