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

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);

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
