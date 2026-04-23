import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  FirstPartyAuthStorage,
  StoredFirstPartyAuthState,
} from "../fpa/client.js";
import type { DpopKeyPair } from "../rp/dpop-client.js";
import { normalizeUrl } from "./oauth-client-metadata.js";

const LEGACY_CREDENTIALS_FILENAME = "credentials.json";

interface PersistedFirstPartyAuthState {
  issuerUrl: string;
  state: StoredFirstPartyAuthState;
}

interface LegacyStoredCredentials {
  accessToken?: string;
  accountSub?: string;
  authSession?: string;
  clientId?: string;
  clientSecret?: string;
  dpopJwk?: DpopKeyPair["privateJwk"];
  dpopPublicJwk?: DpopKeyPair["publicJwk"];
  expiresAt?: number;
  loginHint?: string;
  refreshToken?: string;
  registrationFingerprint?: string;
  registrationMethod?: "cimd" | "dcr";
  zentityUrl?: string;
}

export interface CreateFirstPartyAuthFileStorageOptions {
  baseDir?: string;
  issuerUrl: string | URL;
  legacyCredentialFilePath?: false | string;
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

function resolveLegacyCredentialFile(
  options: CreateFirstPartyAuthFileStorageOptions
): string | undefined {
  if (options.legacyCredentialFilePath === false) {
    return undefined;
  }

  return (
    options.legacyCredentialFilePath ??
    join(resolveBaseDir(options.baseDir), LEGACY_CREDENTIALS_FILENAME)
  );
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

const LEGACY_FIELDS_TO_COPY = [
  "accessToken",
  "accountSub",
  "authSession",
  "clientId",
  "clientSecret",
  "expiresAt",
  "loginHint",
  "refreshToken",
  "registrationFingerprint",
  "registrationMethod",
] as const satisfies readonly (keyof StoredFirstPartyAuthState &
  keyof LegacyStoredCredentials)[];

function mapLegacyCredentials(
  credentials: LegacyStoredCredentials
): StoredFirstPartyAuthState {
  const state: StoredFirstPartyAuthState = {};
  for (const field of LEGACY_FIELDS_TO_COPY) {
    const value = credentials[field];
    if (value !== undefined) {
      (state as Record<string, unknown>)[field] = value;
    }
  }

  if (credentials.dpopJwk && credentials.dpopPublicJwk) {
    state.dpopKeyPair = {
      privateJwk: credentials.dpopJwk,
      publicJwk: credentials.dpopPublicJwk,
    };
  }

  return state;
}

function readLegacyState(
  legacyCredentialFilePath: string | undefined,
  issuerUrl: string
): StoredFirstPartyAuthState | undefined {
  if (!legacyCredentialFilePath) {
    return undefined;
  }

  const legacyCredentials = readJsonFile<LegacyStoredCredentials>(
    legacyCredentialFilePath
  );
  if (
    !legacyCredentials?.zentityUrl ||
    normalizeUrl(legacyCredentials.zentityUrl) !== issuerUrl
  ) {
    return undefined;
  }

  return mapLegacyCredentials(legacyCredentials);
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
  const legacyCredentialFile = resolveLegacyCredentialFile(options);

  return {
    load() {
      return (
        readPersistedState(storageFile, issuerUrl) ??
        readLegacyState(legacyCredentialFile, issuerUrl)
      );
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
