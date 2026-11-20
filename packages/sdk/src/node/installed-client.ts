import type { JWK } from "jose";
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
import { fetchUserInfo } from "../rp/userinfo";
import { authenticateWithLoopbackBrowser } from "./loopback-browser";
import { normalizeUrl } from "./oauth-client-metadata";

const AUTH_ISSUER_SUFFIX_RE = /\/api\/auth\/?$/;

type MaybePromise<T> = Promise<T> | T;

export interface InstalledClientCredentials {
  clientAuth?: {
    clientAssertionAudience: string;
    privateJwk: JWK;
    signingAlgorithm: "ES256";
  };
  clientId: string;
  dpopKey: DpopKeyPair;
}

export interface InstalledOAuthSession {
  accessToken: string;
  accountSub: string;
  clientAuth?: {
    clientAssertionAudience: string;
    privateJwk: JWK;
    signingAlgorithm: "ES256";
  };
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
  privateKeyJwt?: boolean;
  storage: FirstPartyAuthStorage;
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
  const discovery = await auth.discover();
  const authState = await auth.loadState();
  return {
    clientId,
    dpopKey: requireDpopKey(authState),
    ...(authState?.clientAuthMethod === "private_key_jwt" &&
    authState.clientAuthKeyPair?.privateJwk
      ? {
          clientAuth: {
            privateJwk: authState.clientAuthKeyPair.privateJwk,
            signingAlgorithm: "ES256" as const,
            clientAssertionAudience: discovery.issuer,
          },
        }
      : {}),
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
      ...(options.privateKeyJwt ? { privateKeyJwt: true } : {}),
      ...(optionsOverride?.forceClientRegistration ? { force: true } : {}),
    });

    return readClientCredentials(auth, clientId);
  }

  /** The session is the login itself; UserInfo names the account. */
  async function installedSession(
    loginAccessToken: string,
    clientCredentials: InstalledClientCredentials
  ): Promise<InstalledOAuthSession> {
    const discovery = await auth.discover();
    if (!discovery.userinfo_endpoint) {
      throw new Error("Authorization server advertises no userinfo_endpoint");
    }
    const userInfo = await fetchUserInfo({
      accessToken: loginAccessToken,
      dpopClient: await auth.getOrCreateDpopClient(),
      unwrapResponseEnvelope: false,
      userInfoUrl: discovery.userinfo_endpoint,
    });
    if (typeof userInfo?.sub !== "string" || !userInfo.sub) {
      throw new Error("UserInfo returned no subject for the signed-in user");
    }

    return {
      accessToken: loginAccessToken,
      accountSub: userInfo.sub,
      clientId: clientCredentials.clientId,
      dpopKey: clientCredentials.dpopKey,
      scopes: (await auth.loadState())?.scopes ?? [],
      ...(clientCredentials.clientAuth
        ? { clientAuth: clientCredentials.clientAuth }
        : {}),
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
      ...(clientCredentials.clientAuth
        ? {
            clientAuthentication: {
              clientId: clientCredentials.clientId,
              ...clientCredentials.clientAuth,
            },
          }
        : {}),
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
      return await installedSession(loginAccessToken, clientCredentials);
    } catch (error) {
      if (!forceClientRegistration && isInvalidClientError(error)) {
        await auth.clearClientRegistration();
        return ensureOAuthSessionAttempt(true);
      }
    }

    try {
      const browserToken = await authenticateInBrowser(clientCredentials);
      return await installedSession(
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
      const subjectToken = await getLoginAccessToken(clientId);
      const discovery = await auth.discover();
      return exchangeToken({
        audience: exchangeOptions.audience,
        clientId,
        dpopClient: await auth.getOrCreateDpopClient(),
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
      return installedSession(loginAccessToken, clientCredentials);
    },
  } satisfies InstalledClientAuth);
}
