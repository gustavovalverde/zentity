"use client";

import { decode, encode } from "@msgpack/msgpack";

export interface BinaryRequestOptions extends RequestInit {
  timeoutMs?: number;
}

function buildTimeoutSignal(
  original: AbortSignal | null | undefined,
  timeoutMs?: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  if (original) {
    if (original.aborted) {
      controller.abort();
    } else {
      original.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    },
  };
}

export async function fetchMsgpack<T>(
  url: string,
  payload?: unknown,
  options?: BinaryRequestOptions
): Promise<T> {
  const { timeoutMs, ...fetchInit } = options ?? {};
  const headers = new Headers(fetchInit.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/msgpack");
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/msgpack");
  }

  const { signal, cleanup } = buildTimeoutSignal(fetchInit.signal, timeoutMs);
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
    body,
    signal,
  }).finally(cleanup);

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      bodyText || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    return undefined as T;
  }
  return decode(bytes) as T;
}

export function fetchBinary(
  url: string,
  options?: BinaryRequestOptions
): Promise<Response> {
  const { timeoutMs, ...fetchInit } = options ?? {};
  const { signal, cleanup } = buildTimeoutSignal(fetchInit.signal, timeoutMs);
  return fetch(url, { ...fetchInit, signal }).finally(cleanup);
}
