"use client";

const STORAGE_KEY = "zentity-onboarding-draft-v1";
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export interface OnboardingDraft {
  email?: string | null;
  extractedName?: string | null;
  extractedDOB?: string | null;
  extractedDocNumber?: string | null;
  extractedNationality?: string | null;
  extractedNationalityCode?: string | null;
  extractedExpirationDate?: string | null;
  userSalt?: string | null;
  updatedAt: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function loadOnboardingDraft(
  ttlMs: number = DEFAULT_TTL_MS
): OnboardingDraft | null {
  if (!isBrowser()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as OnboardingDraft;
    if (!parsed || typeof parsed.updatedAt !== "number") {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    if (Date.now() - parsed.updatedAt > ttlMs) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function saveOnboardingDraft(
  patch: Partial<Omit<OnboardingDraft, "updatedAt">>
): void {
  if (!isBrowser()) {
    return;
  }

  const current = loadOnboardingDraft() ?? { updatedAt: Date.now() };
  const next: OnboardingDraft = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

export function clearOnboardingDraft(): void {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures
  }
}
