import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
const FHE_URL = process.env.FHE_URL ?? "http://localhost:5001";
const JAEGER_URL = process.env.JAEGER_URL ?? "http://localhost:16686";
const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "";

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

async function getDebugKey(): Promise<{ publicKey: string }> {
  const headers: Record<string, string> = {};
  if (INTERNAL_TOKEN) {
    headers["X-Zentity-Internal-Token"] = INTERNAL_TOKEN;
  }
  return fetchJson<{ publicKey: string }>(`${FHE_URL}/keys/debug`, {
    headers: withTraceHeaders(headers),
  });
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

  let publicKey = process.env.FHE_PUBLIC_KEY;
  if (!publicKey) {
    const debugKey = await timed("Fetch FHE debug public key", getDebugKey);
    publicKey = debugKey.publicKey;
  }

  const commonHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (INTERNAL_TOKEN) {
    commonHeaders["X-Zentity-Internal-Token"] = INTERNAL_TOKEN;
  }

  await timed("FHE encrypt birth year offset", () =>
    fetchJson(`${FHE_URL}/encrypt-birth-year-offset`, {
      method: "POST",
      headers: withTraceHeaders(commonHeaders),
      body: JSON.stringify({
        birthYearOffset: 90,
        publicKey,
      }),
    }),
  );

  await timed("FHE encrypt country code", () =>
    fetchJson(`${FHE_URL}/encrypt-country-code`, {
      method: "POST",
      headers: withTraceHeaders(commonHeaders),
      body: JSON.stringify({
        countryCode: 840,
        publicKey,
      }),
    }),
  );

  await timed("FHE encrypt liveness score", () =>
    fetchJson(`${FHE_URL}/encrypt-liveness`, {
      method: "POST",
      headers: withTraceHeaders(commonHeaders),
      body: JSON.stringify({
        score: 0.87,
        publicKey,
      }),
    }),
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
