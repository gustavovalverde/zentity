import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { gzipSync, gunzipSync } from "node:zlib";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
const FHE_URL = process.env.FHE_URL ?? "http://localhost:5001";
const JAEGER_URL = process.env.JAEGER_URL ?? "http://localhost:16686";
const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { encode, decode } = require("@msgpack/msgpack") as typeof import("@msgpack/msgpack");

const traceId = process.env.OTEL_TRACE_ID ?? randomBytes(16).toString("hex");
const parentSpanId = randomBytes(8).toString("hex");
const traceparent = `00-${traceId}-${parentSpanId}-01`;

function withTraceHeaders(headers: Record<string, string> = {}) {
  return {
    ...headers,
    traceparent,
  };
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  console.log(`${label}: ${durationMs.toFixed(2)}ms`);
  return result;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Request failed ${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as T;
}

async function fetchMsgpack<T>(
  url: string,
  payload: unknown,
  headers: Record<string, string>,
): Promise<T> {
  const encoded = encode(payload);
  const compressed = gzipSync(encoded);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/msgpack",
      "Content-Encoding": "gzip",
      Accept: "application/msgpack",
      "Accept-Encoding": "gzip",
      ...headers,
    },
    body: compressed,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Request failed ${res.status} ${res.statusText}: ${body}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const isGzipped = res.headers
    .get("content-encoding")
    ?.toLowerCase()
    .includes("gzip");
  const decoded = isGzipped ? gunzipSync(buffer) : buffer;
  return decode(decoded) as T;
}

async function getDebugKey(): Promise<{ keyId: string; publicKey: string }> {
  const headers: Record<string, string> = {};
  if (INTERNAL_TOKEN) {
    headers["X-Zentity-Internal-Token"] = INTERNAL_TOKEN;
  }
  return fetchJson<{ keyId: string; publicKey: string }>(`${FHE_URL}/keys/debug`, {
    headers: withTraceHeaders(headers),
  });
}

async function getKeyId(): Promise<string> {
  if (process.env.FHE_KEY_ID) return process.env.FHE_KEY_ID;

  const serverKey = process.env.FHE_SERVER_KEY;
  const publicKey = process.env.FHE_PUBLIC_KEY;
  if (serverKey && publicKey) {
    const headers: Record<string, string> = {};
    if (INTERNAL_TOKEN) headers["X-Zentity-Internal-Token"] = INTERNAL_TOKEN;
    const response = await fetchMsgpack<{ keyId: string }>(
      `${FHE_URL}/keys/register`,
      { serverKey, publicKey },
      withTraceHeaders(headers),
    );
    return response.keyId;
  }

  const debugKey = await getDebugKey();
  return debugKey.keyId;
}

async function run() {
  console.log("Synthetic onboarding trace");
  console.log(`traceId: ${traceId}`);
  console.log(`traceparent: ${traceparent}`);

  const imageBytes = await readFile("fixtures/passport.jpg");
  const imageBase64 = imageBytes.toString("base64");

  await timed("OCR via web /api/ocr", () =>
    fetchJson(`${WEB_URL}/api/ocr`, {
      method: "POST",
      headers: withTraceHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ image: imageBase64 }),
    }),
  );

  const keyId = await timed("Resolve FHE key id", getKeyId);

  const commonHeaders: Record<string, string> = {};
  if (INTERNAL_TOKEN) {
    commonHeaders["X-Zentity-Internal-Token"] = INTERNAL_TOKEN;
  }

  await timed("FHE encrypt batch", () =>
    fetchMsgpack(
      `${FHE_URL}/encrypt-batch`,
      {
        keyId,
        birthYearOffset: 90,
        countryCode: 840,
        complianceLevel: 3,
        livenessScore: 0.87,
      },
      withTraceHeaders(commonHeaders),
    ),
  );

  console.log("Waiting for Jaeger export...");
  await new Promise((resolve) => setTimeout(resolve, 6500));

  try {
    const trace = await fetchJson<{ data?: unknown }>(
      `${JAEGER_URL}/api/traces/${traceId}`,
    );
    if (!trace.data) {
      console.log("Trace not found yet in Jaeger.");
    } else {
      console.log(`Trace available: ${JAEGER_URL}/trace/${traceId}`);
    }
  } catch (error) {
    console.warn("Unable to query Jaeger API:", error);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
