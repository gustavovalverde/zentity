import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Sign-Up Store
 *
 * Minimal store for the account creation wizard (RFC-0017).
 * Contains only fields needed during the sign-up flow:
 * - Step 1: Email entry (optional)
 * - Step 2: Account creation (passkey/password)
 * - Step 3: Keys secured (final state)
 *
 * Identity verification (document, liveness, face match) happens
 * from the dashboard after account creation, managed by useVerificationStore.
 */
interface SignUpStore {
  email: string | null;
  wizardStep: 1 | 2 | 3;
  set: (data: Partial<Omit<SignUpStore, "set" | "reset">>) => void;
  reset: () => void;
}

const initialState: Omit<SignUpStore, "set" | "reset"> = {
  email: null,
  wizardStep: 1,
};

export const useSignUpStore = create<SignUpStore>()(
  persist(
    (set) => ({
      ...initialState,
      set: (data) => set(data),
      reset: () => set(initialState),
    }),
    {
      name: "zentity-sign-up",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
