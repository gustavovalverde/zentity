export function getLivenessDebugEnabled(): boolean {
  const envEnabled = process.env.NEXT_PUBLIC_LIVENESS_DEBUG === "1";

  if (typeof window === "undefined") {
    return (
      envEnabled ||
      process.env.LIVENESS_DEBUG === "1" ||
      process.env.NEXT_PUBLIC_LIVENESS_DEBUG === "true"
    );
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const paramEnabled = params.get("livenessDebug") === "1";
    if (paramEnabled) {
      window.localStorage.setItem("livenessDebug", "1");
    }

    const storedEnabled = window.localStorage.getItem("livenessDebug") === "1";
    return envEnabled || paramEnabled || storedEnabled;
  } catch {
    return envEnabled;
  }
}
