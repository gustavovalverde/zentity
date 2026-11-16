import {
  createFirstPartyAuth,
  type ExchangeTokenResult,
  exchangeToken,
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
  scopes: string[];
}

export interface CreateInstalledClientAuthOptions {
  browserTimeoutMs?: number;
  clientRegistrationRequest: Record<string, unknown>;
  issuerUrl: string | URL;
  loginResource?: string;
  /** Every scope the app needs, including scopes only `exchangeLoginToken` requests. */
  loginScope: string;
  openUrl?: (url: string) => MaybePromise<void>;
  storage: FirstPartyAuthStorage;
  tokenExchangeAudience: string;
  /**
   * The session token's scopes, a subset of `loginScope`. Without it the
   * session token keeps the login's scopes except `offline_access` and the
   * agent bootstrap scopes.
   */
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
  /**
   * Exchanges the stored login token for a DPoP-bound access token limited to
   * `scope` for `audience`, such as an agent bootstrap token. The login must
   * have been granted every scope in `scope`.
   */
  exchangeLoginToken(options: {
    audience: string;
    scope: string;
  }): Promise<ExchangeTokenResult>;
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
    if (!tokenSet.accountSub) {
      throw new Error("Exchanged access token carries no subject");
    }

    return {
      accessToken: tokenSet.accessToken,
      accountSub: tokenSet.accountSub,
      clientId: clientCredentials.clientId,
      dpopKey: clientCredentials.dpopKey,
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
      const loginAccessToken = await getLoginAccessToken(
        clientCredentials.clientId
      );
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

  function getLoginAccessToken(clientId: string): Promise<string> {
    return auth.getAccessToken({
      clientId,
      ...(options.loginResource ? { resource: options.loginResource } : {}),
    });
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
    async exchangeLoginToken(exchangeOptions) {
      const { clientId } = await ensureClientCredentials();
      const [subjectToken, discovery, dpopClient] = await Promise.all([
        getLoginAccessToken(clientId),
        auth.discover(),
        auth.getOrCreateDpopClient(),
      ]);
      return exchangeToken({
        audience: exchangeOptions.audience,
        clientId,
        dpopClient,
        scope: exchangeOptions.scope,
        subjectToken,
        tokenEndpoint: discovery.token_endpoint,
      });
    },
    async refreshOAuthSession() {
      const clientCredentials = await ensureClientCredentials();
      const loginAccessToken = await getLoginAccessToken(
        clientCredentials.clientId
      );
      return exchangeInstalledSession(loginAccessToken, clientCredentials);
    },
  } satisfies InstalledClientAuth);
}
