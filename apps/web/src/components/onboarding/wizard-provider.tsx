"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  defaultWizardData,
  type WizardData,
} from "@/features/auth/schemas/sign-up.schema";
import { trackStep } from "@/lib/analytics";

const TOTAL_STEPS = 4;
const STORAGE_KEY = "zentity-signup-wizard";

type WizardState = {
  currentStep: number;
  data: WizardData;
  isSubmitting: boolean;
};

type WizardAction =
  | { type: "NEXT_STEP" }
  | { type: "PREV_STEP" }
  | { type: "GO_TO_STEP"; step: number }
  | { type: "UPDATE_DATA"; data: Partial<WizardData> }
  | { type: "SET_SUBMITTING"; isSubmitting: boolean }
  | { type: "RESET" }
  | { type: "LOAD_STATE"; state: WizardState };

const initialState: WizardState = {
  currentStep: 1,
  data: defaultWizardData,
  isSubmitting: false,
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
      return action.state;
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
  updateData: (data: Partial<WizardData>) => void;
  setSubmitting: (isSubmitting: boolean) => void;
  reset: () => void;
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

  // Load saved state ONCE on mount and mark as hydrated
  useEffect(() => {
    if (isHydrated) return;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        dispatch({ type: "LOAD_STATE", state: parsed });
      }
    } catch (_error) {}
    isInitializedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsHydrated(true);
  }, [isHydrated]);

  // Save state on changes (skip initial load)
  useEffect(() => {
    if (!isInitializedRef.current) return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_error) {}
  }, [state]);

  const nextStep = () => dispatch({ type: "NEXT_STEP" });
  const prevStep = () => dispatch({ type: "PREV_STEP" });
  const goToStep = (step: number) => dispatch({ type: "GO_TO_STEP", step });
  const updateData = (data: Partial<WizardData>) =>
    dispatch({ type: "UPDATE_DATA", data });
  const setSubmitting = (isSubmitting: boolean) =>
    dispatch({ type: "SET_SUBMITTING", isSubmitting });
  const reset = () => {
    dispatch({ type: "RESET" });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_error) {}
  };

  const value: WizardContextType = {
    state,
    totalSteps: TOTAL_STEPS,
    nextStep,
    prevStep,
    goToStep,
    updateData,
    setSubmitting,
    reset,
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

    // Check if user has entered meaningful data
    const hasUnsavedData = Boolean(
      state.data.email ||
        state.data.idDocument ||
        state.data.selfieImage ||
        state.data.extractedName,
    );

    // Only warn if user is mid-process (not on first or last step with completion)
    const isInProgress =
      state.currentStep > 1 && state.currentStep < TOTAL_STEPS;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedData && isInProgress) {
        e.preventDefault();
        // Modern browsers ignore custom messages, but setting returnValue is required
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isHydrated, state.currentStep, state.data]);

  // Show loading state until hydrated to prevent hydration mismatch
  // Server renders this, client also renders this initially, then switches to actual content
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
