/**
 * JSON fetch wrapper with timeout + structured error reporting.
 *
 * Callers receive `HttpError` on non-2xx responses or unreadable JSON, and a
 * `TimeoutError` DOMException (see `isTimeoutError`) when the request
 * exceeds `timeoutMs`.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly bodyText: string;

  constructor(args: {
    message: string;
    status: number;
    statusText: string;
    url: string;
    bodyText: string;
  }) {
    super(args.message);
    this.name = "HttpError";
    this.status = args.status;
    this.statusText = args.statusText;
    this.url = args.url;
    this.bodyText = args.bodyText;
  }
}

export function safeReadBodyText(response: Response): Promise<string> {
  return response.text().catch(() => "");
}

/** `AbortSignal.timeout` rejects with a DOMException named `TimeoutError`. */
export function isTimeoutError(error: unknown): error is Error {
  return error instanceof Error && error.name === "TimeoutError";
}

interface FetchJsonOptions extends RequestInit {
  /** Request timeout in milliseconds. Defaults to 60000 (60 seconds). */
  timeoutMs?: number;
}

/** The timeout covers reading the response body as well as the headers. */
export function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(url, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
}

export async function fetchJson<T>(
  url: string,
  init?: FetchJsonOptions
): Promise<T> {
  const { timeoutMs = 60_000, ...fetchInit } = init ?? {};

  const response = await fetchWithTimeout(url, fetchInit, timeoutMs);

  if (!response.ok) {
    const bodyText = await safeReadBodyText(response);
    throw new HttpError({
      message: `Request failed: ${response.status} ${response.statusText}`,
      status: response.status,
      statusText: response.statusText,
      url,
      bodyText,
    });
  }

  const bodyText = await response.text();
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new HttpError({
      message: "Invalid JSON response",
      status: response.status,
      statusText: response.statusText,
      url,
      bodyText,
    });
  }
}
