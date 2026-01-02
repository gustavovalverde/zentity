import "server-only";

import crypto from "node:crypto";

import {
  ANTISPOOF_LIVE_THRESHOLD,
  ANTISPOOF_REAL_THRESHOLD,
  FACE_MATCH_MIN_CONFIDENCE,
} from "@/lib/liveness/liveness-policy";

import { MIN_AGE_POLICY, NATIONALITY_GROUP, POLICY_VERSION } from "./policy";

interface PolicyConfig {
  version: string;
  minAge: number;
  faceMatchMinConfidence: number;
  nationalityGroup: string;
  antispoofRealThreshold: number;
  antispoofLiveThreshold: number;
}

const POLICY_CONFIG: PolicyConfig = {
  version: POLICY_VERSION,
  minAge: MIN_AGE_POLICY,
  faceMatchMinConfidence: FACE_MATCH_MIN_CONFIDENCE,
  nationalityGroup: NATIONALITY_GROUP,
  antispoofRealThreshold: ANTISPOOF_REAL_THRESHOLD,
  antispoofLiveThreshold: ANTISPOOF_LIVE_THRESHOLD,
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function computePolicyHash(config: PolicyConfig): string {
  const hash = crypto.createHash("sha256");
  hash.update(stableStringify(config));
  return hash.digest("hex");
}

export const POLICY_HASH = computePolicyHash(POLICY_CONFIG);
export { POLICY_CONFIG };
