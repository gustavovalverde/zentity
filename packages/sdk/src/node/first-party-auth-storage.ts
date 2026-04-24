import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  FirstPartyAuthStorage,
  StoredFirstPartyAuthState,
} from "../fpa/client";
import { normalizeUrl } from "./oauth-client-metadata";

interface PersistedFirstPartyAuthState {
  issuerUrl: string;
  state: StoredFirstPartyAuthState;
}

export interface CreateFirstPartyAuthFileStorageOptions {
  baseDir?: string;
  issuerUrl: string | URL;
  namespace: string;
}

function issuerUrlToString(issuerUrl: string | URL): string {
  return normalizeUrl(
    issuerUrl instanceof URL ? issuerUrl.toString() : issuerUrl
  );
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function resolveBaseDir(baseDir: string | undefined): string {
  return baseDir ?? join(homedir(), ".zentity");
}

function requireStorageNamespace(namespace: string): string {
  const storageNamespace = namespace.trim();
  if (storageNamespace.length === 0) {
    throw new Error(
      "First-party auth file storage requires a non-empty namespace"
    );
  }

  return storageNamespace;
}

function resolveStorageDirectory(options: {
  baseDir?: string;
  namespace: string;
}): string {
  return join(
    resolveBaseDir(options.baseDir),
    options.namespace,
    "first-party-auth"
  );
}

function resolveStorageFile(options: {
  baseDir?: string;
  issuerUrl: string | URL;
  namespace: string;
}): string {
  const issuerKey = createHash("sha256")
    .update(issuerUrlToString(options.issuerUrl))
    .digest("hex");
  return join(resolveStorageDirectory(options), `${issuerKey}.json`);
}

function readJsonFile<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch (error) {
    if (isFileNotFound(error) || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

function readPersistedState(
  filePath: string,
  issuerUrl: string
): StoredFirstPartyAuthState | undefined {
  const persisted = readJsonFile<PersistedFirstPartyAuthState>(filePath);
  if (!persisted || normalizeUrl(persisted.issuerUrl) !== issuerUrl) {
    return undefined;
  }

  return persisted.state;
}

export function createFirstPartyAuthFileStorage(
  options: CreateFirstPartyAuthFileStorageOptions
): FirstPartyAuthStorage {
  const storageNamespace = requireStorageNamespace(options.namespace);
  const issuerUrl = issuerUrlToString(options.issuerUrl);
  const storageOptions = {
    namespace: storageNamespace,
    ...(options.baseDir ? { baseDir: options.baseDir } : {}),
  };
  const storageFile = resolveStorageFile({
    ...storageOptions,
    issuerUrl: options.issuerUrl,
  });

  return {
    load() {
      return readPersistedState(storageFile, issuerUrl);
    },
    save(state) {
      mkdirSync(resolveStorageDirectory(storageOptions), {
        mode: 0o700,
        recursive: true,
      });
      const persisted: PersistedFirstPartyAuthState = {
        issuerUrl,
        state,
      };
      writeFileSync(storageFile, JSON.stringify(persisted, null, 2), {
        mode: 0o600,
      });
    },
  };
}
