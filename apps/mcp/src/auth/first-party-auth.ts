import {
  createFirstPartyAuth,
  type FirstPartyAuth,
  type StoredFirstPartyAuthState,
} from "@zentity/sdk/fpa";
import { config } from "../config.js";
import {
  loadCredentials,
  type StoredCredentials,
  saveCredentials,
} from "./credentials.js";

const TRAILING_SLASHES = /\/+$/;

const firstPartyAuthByIssuerUrl = new Map<string, FirstPartyAuth>();

function normalizeIssuerUrl(issuerUrl: string): string {
  return issuerUrl.replace(TRAILING_SLASHES, "");
}

function mapCredentialsToAuthState(
  credentials: StoredCredentials | undefined
): StoredFirstPartyAuthState | undefined {
  if (!credentials) {
    return undefined;
  }

  return {
    ...(credentials.accessToken
      ? { accessToken: credentials.accessToken }
      : {}),
    ...(credentials.accountSub ? { accountSub: credentials.accountSub } : {}),
    ...(credentials.authSession
      ? { authSession: credentials.authSession }
      : {}),
    ...(credentials.clientId ? { clientId: credentials.clientId } : {}),
    ...(credentials.clientSecret
      ? { clientSecret: credentials.clientSecret }
      : {}),
    ...(credentials.dpopJwk && credentials.dpopPublicJwk
      ? {
          dpopKeyPair: {
            privateJwk: credentials.dpopJwk,
            publicJwk: credentials.dpopPublicJwk,
          },
        }
      : {}),
    ...(credentials.expiresAt ? { expiresAt: credentials.expiresAt } : {}),
    ...(credentials.loginHint ? { loginHint: credentials.loginHint } : {}),
    ...(credentials.refreshToken
      ? { refreshToken: credentials.refreshToken }
      : {}),
    ...(credentials.registrationFingerprint
      ? { registrationFingerprint: credentials.registrationFingerprint }
      : {}),
    ...(credentials.registrationMethod
      ? { registrationMethod: credentials.registrationMethod }
      : {}),
  };
}

function mapAuthStateToCredentials(
  credentialIssuerUrl: string,
  authState: StoredFirstPartyAuthState
): StoredCredentials {
  return {
    zentityUrl: credentialIssuerUrl,
    clientId: authState.clientId ?? "",
    ...(authState.accessToken ? { accessToken: authState.accessToken } : {}),
    ...(authState.accountSub ? { accountSub: authState.accountSub } : {}),
    ...(authState.authSession ? { authSession: authState.authSession } : {}),
    ...(authState.clientSecret ? { clientSecret: authState.clientSecret } : {}),
    ...(authState.dpopKeyPair
      ? {
          dpopJwk: authState.dpopKeyPair.privateJwk,
          dpopPublicJwk: authState.dpopKeyPair.publicJwk,
        }
      : {}),
    ...(authState.expiresAt ? { expiresAt: authState.expiresAt } : {}),
    ...(authState.loginHint ? { loginHint: authState.loginHint } : {}),
    ...(authState.refreshToken ? { refreshToken: authState.refreshToken } : {}),
    ...(authState.registrationFingerprint
      ? { registrationFingerprint: authState.registrationFingerprint }
      : {}),
    ...(authState.registrationMethod
      ? { registrationMethod: authState.registrationMethod }
      : {}),
  };
}

function createCredentialStorage(credentialIssuerUrl: string) {
  return {
    load() {
      return mapCredentialsToAuthState(loadCredentials(credentialIssuerUrl));
    },
    save(authState: StoredFirstPartyAuthState) {
      saveCredentials(
        mapAuthStateToCredentials(credentialIssuerUrl, authState)
      );
    },
  };
}

export function ensureFirstPartyAuth(
  credentialIssuerUrl = config.zentityUrl
): FirstPartyAuth {
  const discoveryIssuerUrl = normalizeIssuerUrl(credentialIssuerUrl);
  const cached = firstPartyAuthByIssuerUrl.get(discoveryIssuerUrl);
  if (cached) {
    return cached;
  }

  const auth = createFirstPartyAuth({
    issuerUrl: discoveryIssuerUrl,
    storage: createCredentialStorage(credentialIssuerUrl),
  });
  firstPartyAuthByIssuerUrl.set(discoveryIssuerUrl, auth);
  return auth;
}

export function clearFirstPartyAuthCache(credentialIssuerUrl?: string): void {
  if (credentialIssuerUrl) {
    firstPartyAuthByIssuerUrl.delete(normalizeIssuerUrl(credentialIssuerUrl));
    return;
  }

  firstPartyAuthByIssuerUrl.clear();
}
