export function redirectTo(path: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.location.assign(path);
}
