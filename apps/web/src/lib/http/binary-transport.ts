"use client";

import { decode, encode } from "@msgpack/msgpack";

import { HttpError, safeReadBodyText } from "@/lib/http/fetch";

export async function fetchMsgpack<T>(
  url: string,
  payload?: unknown,
  fetchInit: RequestInit = {}
): Promise<T> {
  const headers = new Headers(fetchInit.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/msgpack");
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/msgpack");
  }

  let body: ArrayBuffer | undefined;
  if (payload !== undefined) {
    const bytes = payload instanceof Uint8Array ? payload : encode(payload);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    body = copy.buffer;
  }

  const response = await fetch(url, {
    method: fetchInit.method ?? "POST",
    ...fetchInit,
    headers,
    ...(body === undefined ? {} : { body }),
  });

  if (!response.ok) {
    const bodyText = await safeReadBodyText(response);
    throw new HttpError({
      message:
        bodyText || `Request failed: ${response.status} ${response.statusText}`,
      status: response.status,
      statusText: response.statusText,
      url,
      bodyText,
    });
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    return undefined as T;
  }
  return decode(bytes) as T;
}

export function fetchBinary(
  url: string,
  options?: RequestInit
): Promise<Response> {
  return fetch(url, options);
}
