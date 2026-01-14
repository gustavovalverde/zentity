import crypto from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type DemoOffer = {
  id: string;
  scenarioId: string;
  createdAt: number;
  issuer: string;
  credentialConfigurationId: string;
  offer: Record<string, unknown>;
};

export type DemoRequest = {
  id: string;
  scenarioId: string;
  createdAt: number;
  nonce: string;
  requiredClaims: string[];
  purpose: string;
  status: "pending" | "verified" | "failed";
  result?: Record<string, unknown>;
};

type DemoStore = {
  offers: Record<string, DemoOffer>;
  requests: Record<string, DemoRequest>;
};

const TTL_MS = 15 * 60 * 1000;
const STORE_PATH =
  process.env.DEMO_STORE_PATH ??
  path.join(process.cwd(), ".demo-store.json");

function readStore(): DemoStore {
  if (!existsSync(STORE_PATH)) {
    return { offers: {}, requests: {} };
  }
  try {
    const raw = readFileSync(STORE_PATH, "utf8");
    const data = JSON.parse(raw) as DemoStore;
    if (!data || typeof data !== "object") {
      return { offers: {}, requests: {} };
    }
    return {
      offers: data.offers ?? {},
      requests: data.requests ?? {},
    };
  } catch {
    return { offers: {}, requests: {} };
  }
}

function writeStore(store: DemoStore) {
  const tmpPath = `${STORE_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(store, null, 2));
  renameSync(tmpPath, STORE_PATH);
}

function cleanup<T extends { createdAt: number }>(
  record: Record<string, T>
): boolean {
  const now = Date.now();
  let changed = false;
  for (const [id, value] of Object.entries(record)) {
    if (now - value.createdAt > TTL_MS) {
      delete record[id];
      changed = true;
    }
  }
  return changed;
}

export function createOffer(input: Omit<DemoOffer, "id" | "createdAt">) {
  const store = readStore();
  cleanup(store.offers);
  const id = crypto.randomUUID();
  const offer: DemoOffer = { ...input, id, createdAt: Date.now() };
  store.offers[id] = offer;
  writeStore(store);
  return offer;
}

export function getOffer(id: string) {
  const store = readStore();
  const changed = cleanup(store.offers);
  if (changed) {
    writeStore(store);
  }
  return store.offers[id] ?? null;
}

export function createRequest(
  input: Omit<DemoRequest, "id" | "createdAt" | "status">
) {
  const store = readStore();
  cleanup(store.requests);
  const id = crypto.randomUUID();
  const request: DemoRequest = {
    ...input,
    id,
    createdAt: Date.now(),
    status: "pending",
  };
  store.requests[id] = request;
  writeStore(store);
  return request;
}

export function getRequest(id: string) {
  const store = readStore();
  const changed = cleanup(store.requests);
  if (changed) {
    writeStore(store);
  }
  return store.requests[id] ?? null;
}

export function updateRequest(
  id: string,
  update: Partial<DemoRequest>
): DemoRequest | null {
  const store = readStore();
  cleanup(store.requests);
  const current = store.requests[id];
  if (!current) {
    return null;
  }
  const next = { ...current, ...update };
  store.requests[id] = next;
  writeStore(store);
  return next;
}
