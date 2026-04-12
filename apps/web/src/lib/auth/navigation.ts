export function redirectTo(path: string): void {
  if (globalThis.window === undefined) {
    return;
  }

  globalThis.window.location.assign(path);
}

export function getSafeRedirectPath(
  value: string | null | undefined,
  fallback = "/"
): string {
  if (!value) {
    return fallback;
  }

  // Only allow same-origin relative paths.
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  return fallback;
}
