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

async function safeReadBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    try {
      const jsonValue = (await response.json()) as unknown;
      return JSON.stringify(jsonValue);
    } catch {
      return "";
    }
  }
}

class TimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

interface FetchJsonOptions extends RequestInit {
  /** Request timeout in milliseconds. Defaults to 60000 (60 seconds). */
  timeoutMs?: number;
}

export async function fetchJson<T>(
  url: string,
  init?: FetchJsonOptions,
): Promise<T> {
  const { timeoutMs = 60000, ...fetchInit } = init ?? {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new TimeoutError(url, timeoutMs);
    }
    throw error;
  }
  clearTimeout(timeoutId);

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

  try {
    return (await response.json()) as T;
  } catch {
    const bodyText = await safeReadBodyText(response);
    throw new HttpError({
      message: "Invalid JSON response",
      status: response.status,
      statusText: response.statusText,
      url,
      bodyText,
    });
  }
}
