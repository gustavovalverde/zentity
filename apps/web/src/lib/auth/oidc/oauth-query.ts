import "server-only";

import { createHmac } from "node:crypto";

import { constantTimeEqual, makeSignature } from "better-auth/crypto";

import { env } from "@/env";

export async function verifySignedOAuthQuery(
  query: string
): Promise<URLSearchParams> {
  const params = new URLSearchParams(query);
  const sig = params.get("sig");
  const exp = Number(params.get("exp"));
  params.delete("sig");

  const verifySig = await makeSignature(
    params.toString(),
    env.BETTER_AUTH_SECRET
  );
  if (
    !(sig && constantTimeEqual(sig, verifySig)) ||
    Number.isNaN(exp) ||
    new Date(exp * 1000) < new Date()
  ) {
    throw new Error("invalid_signature");
  }

  params.delete("exp");
  return params;
}

export function parseRequestedScopes(queryParams: URLSearchParams): string[] {
  return (queryParams.get("scope") ?? "")
    .split(" ")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

type CanonicalQueryValue =
  | null
  | string
  | number
  | boolean
  | CanonicalQueryValue[]
  | { [key: string]: CanonicalQueryValue };

function normalizeCanonicalValue(value: unknown): CanonicalQueryValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCanonicalValue(entry));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalizeCanonicalValue(entry)])
    );
  }

  return String(value);
}

function canonicalizeQueryRecord(
  query: Record<string, unknown>
): Record<string, CanonicalQueryValue> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(
        ([key, value]) => key !== "sig" && key !== "exp" && value !== undefined
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, normalizeCanonicalValue(value)])
  );
}

function canonicalizeOAuthQuery(
  query: URLSearchParams | Record<string, unknown>
): string {
  if (query instanceof URLSearchParams) {
    const record: Record<string, string | string[]> = {};
    const keys = [...new Set(query.keys())].sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      if (key === "sig" || key === "exp") {
        continue;
      }
      const values = query.getAll(key);
      if (values.length === 1) {
        record[key] = values[0] ?? "";
      } else if (values.length > 1) {
        record[key] = values;
      }
    }
    return JSON.stringify(record);
  }

  return JSON.stringify(canonicalizeQueryRecord(query));
}

export function computeOAuthRequestKey(
  query: URLSearchParams | Record<string, unknown>
): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(canonicalizeOAuthQuery(query))
    .digest("hex");
}
