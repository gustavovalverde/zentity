"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

const STORAGE_KEY = "zentity-privacy-mode";

// Module-level subscriber set for same-tab notifications.
// The browser "storage" event only fires on *other* tabs, so we notify
// same-tab consumers directly via this set after writing to localStorage.
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

interface PrivacyModeContextValue {
  privacyMode: boolean;
  togglePrivacyMode: () => void;
}

const PrivacyModeContext = createContext<PrivacyModeContextValue>({
  privacyMode: false,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: default no-op
  togglePrivacyMode: () => {},
});

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);

  // Cross-tab sync via the native storage event
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener("storage", handler);

  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot() {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function getServerSnapshot() {
  return false;
}

function usePrivacyModeStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function PrivacyModeProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const privacyMode = usePrivacyModeStore();

  const togglePrivacyMode = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, String(!privacyMode));
    emitChange();
  }, [privacyMode]);

  const value = useMemo(
    () => ({ privacyMode, togglePrivacyMode }),
    [privacyMode, togglePrivacyMode]
  );

  return <PrivacyModeContext value={value}>{children}</PrivacyModeContext>;
}

export function usePrivacyMode() {
  return useContext(PrivacyModeContext);
}
