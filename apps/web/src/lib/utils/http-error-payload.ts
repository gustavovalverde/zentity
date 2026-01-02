import { HttpError } from "./http";

function getErrorStringFromBodyText(bodyText: string): string | undefined {
  if (!bodyText) {
    return;
  }

  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (typeof parsed === "string") {
      return parsed;
    }
    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const maybeError = (parsed as { error?: unknown }).error;
    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError;
    }

    const maybeMessage = (parsed as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
  } catch {
    // ignore
  }

  return;
}

export function toServiceErrorPayload(
  error: unknown,
  fallbackMessage: string
): { status: number; payload: { error: string } } {
  if (error instanceof HttpError) {
    const message =
      getErrorStringFromBodyText(error.bodyText) ?? fallbackMessage;
    return { status: error.status, payload: { error: message } };
  }

  if (error instanceof Error && error.message) {
    return { status: 503, payload: { error: error.message } };
  }

  return { status: 503, payload: { error: fallbackMessage } };
}
