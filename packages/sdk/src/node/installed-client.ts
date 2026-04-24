import {
  createFirstPartyAuth,
  type FirstPartyAuth,
  type FirstPartyAuthDiscoveryDocument,
  type FirstPartyAuthStorage,
  type StoredFirstPartyAuthState,
} from "../fpa/index";
import type { DpopKeyPair } from "../rp/dpop-client";
import { authenticateWithLoopbackBrowser } from "./loopback-browser";
import { normalizeUrl } from "./oauth-client-metadata";

const AUTH_ISSUER_SUFFIX_RE = /\/api\/auth\/?$/;

type MaybePromise<T> = Promise<T> | T;

export interface InstalledClientCredentials {
  clientId: string;
  dpopKey: DpopKeyPair;
}

export interface InstalledOAuthSession {
  accessToken: string;
  accountSub: string;
  clientId: string;
  dpopKey: DpopKeyPair;
  loginHint: string;
  scopes: string[];
}

export interface CreateInstalledClientAuthOptions {
  browserTimeoutMs?: number;
  clientRegistrationRequest: Record<string, unknown>;
  issuerUrl: string | URL;
  loginResource?: string;
  loginScope: string;
  openUrl?: (url: string) => MaybePromise<void>;
  storage: FirstPartyAuthStorage;
  tokenExchangeAudience: string;
  tokenExchangeScope?: string;
}

export interface InstalledClientAuth {
  clearClientRegistration(): Promise<void>;
  clearTokens(): Promise<void>;
  discover(): Promise<FirstPartyAuthDiscoveryDocument>;
  ensureClientCredentials(options?: {
    forceClientRegistration?: boolean;
  }): Promise<InstalledClientCredentials>;
  ensureOAuthSession(): Promise<InstalledOAuthSession>;
  getCachedIssuer(): string | undefined;
  getCachedJwksUri(): string | undefined;
  refreshOAuthSession(): Promise<InstalledOAuthSession>;
}

function readScopes(scope: string | undefined): string[] {
  return typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
}

function isInvalidClientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("invalid_client") || message.includes("client not found")
  );
}

function readStoredIdentity(
  authState: StoredFirstPartyAuthState | undefined
): Pick<InstalledOAuthSession, "accountSub" | "loginHint"> {
  return {
    accountSub: authState?.accountSub ?? "",
    loginHint: authState?.loginHint ?? "",
  };
}

function requireDpopKey(
  authState: StoredFirstPartyAuthState | undefined
): DpopKeyPair {
  if (!authState?.dpopKeyPair) {
    throw new Error("First-party auth state missing dpopKeyPair");
  }

  return authState.dpopKeyPair;
}

async function readClientCredentials(
  auth: FirstPartyAuth,
  clientId: string
): Promise<InstalledClientCredentials> {
  await auth.getOrCreateDpopClient();
  const authState = await auth.loadState();
  return {
    clientId,
    dpopKey: requireDpopKey(authState),
  };
}

export function deriveAppAudience(issuerUrl: string | URL): string {
  const normalizedIssuer = normalizeUrl(
    issuerUrl instanceof URL ? issuerUrl.toString() : issuerUrl
  );
  if (!AUTH_ISSUER_SUFFIX_RE.test(normalizedIssuer)) {
    return normalizedIssuer;
  }

  const issuerAsUrl = new URL(normalizedIssuer);
  issuerAsUrl.pathname =
    issuerAsUrl.pathname.replace(AUTH_ISSUER_SUFFIX_RE, "") || "/";
  issuerAsUrl.search = "";
  issuerAsUrl.hash = "";
  return normalizeUrl(issuerAsUrl.toString());
}

export function createInstalledClientAuth(
  options: CreateInstalledClientAuthOptions
): InstalledClientAuth {
  const auth = createFirstPartyAuth({
    issuerUrl: options.issuerUrl,
    storage: options.storage,
  });

  async function ensureClientCredentials(optionsOverride?: {
    forceClientRegistration?: boolean;
  }): Promise<InstalledClientCredentials> {
    const clientId = await auth.ensureClientRegistration({
      request: options.clientRegistrationRequest,
      ...(optionsOverride?.forceClientRegistration ? { force: true } : {}),
    });

    return readClientCredentials(auth, clientId);
  }

  async function exchangeInstalledSession(
    loginAccessToken: string,
    clientCredentials: InstalledClientCredentials
  ): Promise<InstalledOAuthSession> {
    const tokenSet = await auth.exchangeToken({
      audience: options.tokenExchangeAudience,
      clientId: clientCredentials.clientId,
      ...(options.tokenExchangeScope
        ? { scope: options.tokenExchangeScope }
        : {}),
      subjectToken: loginAccessToken,
    });
    const storedIdentity = readStoredIdentity(await auth.loadState());

    return {
      accessToken: tokenSet.accessToken,
      accountSub: tokenSet.accountSub ?? storedIdentity.accountSub,
      clientId: clientCredentials.clientId,
      dpopKey: clientCredentials.dpopKey,
      loginHint: tokenSet.loginHint ?? storedIdentity.loginHint,
      scopes: readScopes(tokenSet.scope),
    };
  }

  async function authenticateInBrowser(
    clientCredentials: InstalledClientCredentials
  ) {
    const discovery = await auth.discover();
    const pkce = await auth.generatePkce();

    return authenticateWithLoopbackBrowser({
      authorizeEndpoint: discovery.authorization_endpoint,
      clientId: clientCredentials.clientId,
      dpopClient: await auth.getOrCreateDpopClient(),
      exchangeAuthorizationCode(exchangeOptions) {
        return auth.exchangeAuthorizationCode(exchangeOptions);
      },
      ...(options.openUrl ? { openUrl: options.openUrl } : {}),
      ...(discovery.pushed_authorization_request_endpoint
        ? {
            parEndpoint: discovery.pushed_authorization_request_endpoint,
          }
        : {}),
      pkce,
      ...(options.loginResource ? { resource: options.loginResource } : {}),
      scope: options.loginScope,
      ...(typeof options.browserTimeoutMs === "number"
        ? { timeoutMs: options.browserTimeoutMs }
        : {}),
    });
  }

  async function ensureOAuthSessionAttempt(
    forceClientRegistration = false
  ): Promise<InstalledOAuthSession> {
    const clientCredentials = await ensureClientCredentials({
      forceClientRegistration,
    });

    try {
      const loginAccessToken = await auth.getAccessToken({
        clientId: clientCredentials.clientId,
        ...(options.loginResource ? { resource: options.loginResource } : {}),
      });
      return await exchangeInstalledSession(
        loginAccessToken,
        clientCredentials
      );
    } catch (error) {
      if (!forceClientRegistration && isInvalidClientError(error)) {
        await auth.clearClientRegistration();
        return ensureOAuthSessionAttempt(true);
      }
    }

    try {
      const browserToken = await authenticateInBrowser(clientCredentials);
      return await exchangeInstalledSession(
        browserToken.accessToken,
        clientCredentials
      );
    } catch (error) {
      if (!forceClientRegistration && isInvalidClientError(error)) {
        await auth.clearClientRegistration();
        return ensureOAuthSessionAttempt(true);
      }
      throw error;
    }
  }

  return Object.freeze({
    clearClientRegistration() {
      return auth.clearClientRegistration();
    },
    clearTokens() {
      return auth.clearTokens();
    },
    discover() {
      return auth.discover();
    },
    ensureClientCredentials,
    ensureOAuthSession() {
      return ensureOAuthSessionAttempt();
    },
    getCachedIssuer() {
      return auth.getCachedIssuer();
    },
    getCachedJwksUri() {
      return auth.getCachedJwksUri();
    },
    async refreshOAuthSession() {
      const clientCredentials = await ensureClientCredentials();
      const loginAccessToken = await auth.getAccessToken({
        clientId: clientCredentials.clientId,
        ...(options.loginResource ? { resource: options.loginResource } : {}),
      });
      return exchangeInstalledSession(loginAccessToken, clientCredentials);
    },
  } satisfies InstalledClientAuth);
}
