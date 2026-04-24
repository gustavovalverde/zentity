import type { SdkErrorCode } from "../protocol/claims";
import {
  createDpopClientFromKeyPair,
  generateDpopKeyPair,
  type DpopClient,
  type DpopKeyPair,
} from "../rp/dpop-client";
import { createDiscoveryResolver, type FirstPartyAuthDiscoveryDocument } from "./discovery";
import { ensureOpaqueReady, finishOpaqueLogin, startOpaqueLogin } from "./opaque";
import {
  exchangeAuthorizationCode,
  exchangeToken,
  type ExchangeTokenResult,
  type TokenResult,
} from "./oauth";
import {
  generatePkceChallenge,
  type PkceChallenge,
} from "./pkce";

type MaybePromise<T> = Promise<T> | T;

const PROACTIVE_REFRESH_MS = 60_000;

export interface StoredFirstPartyAuthState {
  accessToken?: string;
  accountSub?: string;
  authSession?: string;
  clientId?: string;
  clientSecret?: string;
  dpopKeyPair?: DpopKeyPair;
  expiresAt?: number;
  loginHint?: string;
  refreshToken?: string;
  registrationFingerprint?: string;
  registrationMethod?: "cimd" | "dcr";
}

export interface FirstPartyAuthStorage {
  load(): MaybePromise<StoredFirstPartyAuthState | undefined>;
  save(state: StoredFirstPartyAuthState): MaybePromise<void>;
}

export interface CreateFirstPartyAuthOptions {
  discoveryTtlMs?: number;
  issuerUrl: string | URL;
  storage: FirstPartyAuthStorage;
}

export interface ClientRegistrationRequest {
  force?: boolean;
  request: Record<string, unknown>;
}

export interface PasswordAuthorizationStrategy {
  password: string;
}

export interface WalletAuthorizationStrategy {
  chainId?: number;
  signTypedData(typedData: Record<string, unknown>): MaybePromise<string>;
}

export interface AuthorizationStrategies {
  password?: PasswordAuthorizationStrategy;
  wallet?: WalletAuthorizationStrategy;
}

export interface AuthorizeOptions {
  clientId: string;
  claims?: string;
  identifier: string;
  pkce: PkceChallenge;
  resource?: string;
  scope: string;
  strategies: AuthorizationStrategies;
}

export interface ResumeAuthorizationOptions {
  authSession: string;
  pkce?: Pick<PkceChallenge, "codeChallenge" | "codeChallengeMethod">;
  strategies: AuthorizationStrategies;
}

export interface AuthenticationOptions {
  claims?: string;
  clientId: string;
  identifier: string;
  redirectUri: string;
  resource?: string;
  scope: string;
  strategies: AuthorizationStrategies;
}

export interface StepUpOptions {
  authSession: string;
  clientId: string;
  redirectUri: string;
  resource?: string;
  strategies: AuthorizationStrategies;
}

export interface AuthorizationCodeResult {
  authSession: string;
  authorizationCode: string;
  exportKey?: string;
  loginMethod?: "eip712" | "opaque";
}

export interface AuthenticationResult extends TokenResult {
  authSession: string;
  exportKey?: string;
  loginMethod?: "eip712" | "opaque";
}

interface RefreshTokenResponseBody {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
}

interface StepUpErrorBody {
  acr_values?: string;
  auth_session?: string;
  error: string;
  error_description?: string;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

async function parseJsonBody(response: Response): Promise<Record<string, unknown>> {
  return ((await response.json().catch(() => ({}))) ?? {}) as Record<
    string,
    unknown
  >;
}

function requireChallengeEndpoint(document: FirstPartyAuthDiscoveryDocument): string {
  if (!document.authorization_challenge_endpoint) {
    throw new Error(
      "Discovery response missing authorization_challenge_endpoint"
    );
  }
  return document.authorization_challenge_endpoint;
}

function requireTokenEndpoint(document: FirstPartyAuthDiscoveryDocument): string {
  return document.token_endpoint;
}

function readAuthorizationCode(body: Record<string, unknown>): string {
  const authorizationCode = body.authorization_code;
  if (typeof authorizationCode !== "string" || authorizationCode.length === 0) {
    throw new Error("Authorization response missing authorization_code");
  }
  return authorizationCode;
}

function readChallengeType(body: Record<string, unknown>): "eip712" | "opaque" {
  const challengeType = body.challenge_type;
  if (challengeType === "opaque" || challengeType === "eip712") {
    return challengeType;
  }
  throw new Error(`Unsupported challenge type: ${String(challengeType)}`);
}

function readAuthSession(body: Record<string, unknown>): string {
  const authSession = body.auth_session;
  if (typeof authSession !== "string" || authSession.length === 0) {
    throw new Error("Challenge response missing auth_session");
  }
  return authSession;
}

function readOpaqueLoginResponse(body: Record<string, unknown>): string {
  const loginResponse = body.opaque_login_response;
  if (typeof loginResponse !== "string" || loginResponse.length === 0) {
    throw new Error("OPAQUE response missing opaque_login_response");
  }
  return loginResponse;
}

function readTypedData(body: Record<string, unknown>): Record<string, unknown> {
  const typedData = body.typed_data;
  if (!typedData || typeof typedData !== "object" || Array.isArray(typedData)) {
    throw new Error("EIP-712 response missing typed_data");
  }
  return typedData as Record<string, unknown>;
}

async function postChallenge(
  dpopClient: DpopClient,
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ body: Record<string, unknown>; response: Response }> {
  const { response } = await dpopClient.withNonceRetry(async (nonce) => {
    const proof = await dpopClient.proofFor("POST", endpoint, undefined, nonce);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        DPoP: proof,
      },
      body: JSON.stringify(body),
    });
    return { response, result: null };
  });

  return { body: await parseJsonBody(response.clone()), response };
}

async function buildAuthenticationResult(
  authorization: AuthorizationCodeResult,
  token: TokenResult
): Promise<AuthenticationResult> {
  return {
    ...token,
    authSession: authorization.authSession,
    ...(authorization.exportKey
      ? { exportKey: authorization.exportKey }
      : {}),
    ...(authorization.loginMethod
      ? { loginMethod: authorization.loginMethod }
      : {}),
  };
}

export class RedirectToWebError extends Error {
  readonly authSession: string;
  readonly requestUri?: string;

  constructor(authSession: string, requestUri?: string) {
    super("Passkey-only user — redirect to browser required");
    this.authSession = authSession;
    this.name = "RedirectToWebError";
    if (requestUri) {
      this.requestUri = requestUri;
    }
  }
}

export class StepUpRequiredError extends Error {
  readonly acrValues?: string;
  readonly authSession: string;

  constructor(authSession: string, acrValues?: string) {
    super("Step-up re-authentication required");
    this.authSession = authSession;
    this.name = "StepUpRequiredError";
    if (acrValues) {
      this.acrValues = acrValues;
    }
  }
}

export class TokenExpiredError extends Error {
  constructor() {
    super("No valid credentials — re-authentication required");
    this.name = "TokenExpiredError";
  }
}

export class TokenRefreshError extends Error {
  readonly code: SdkErrorCode = "token_refresh_failed";
  readonly responseBody: string;
  readonly status: number;

  constructor(status: number, responseBody: string) {
    super(`Token refresh failed: ${status} ${responseBody}`);
    this.name = "TokenRefreshError";
    this.responseBody = responseBody;
    this.status = status;
  }
}

export interface FirstPartyAuth {
  authenticate(options: AuthenticationOptions): Promise<AuthenticationResult>;
  authorize(options: AuthorizeOptions): Promise<AuthorizationCodeResult>;
  clearClientRegistration(): Promise<void>;
  clearDiscoveryCache(): void;
  clearTokens(): Promise<void>;
  detectStepUp(status: number, responseBody: string): void;
  discover(): Promise<FirstPartyAuthDiscoveryDocument>;
  ensureClientRegistration(options: ClientRegistrationRequest): Promise<string>;
  exchangeAuthorizationCode(options: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    resource?: string;
  }): Promise<TokenResult>;
  exchangeToken(options: {
    audience: string;
    clientId: string;
    scope?: string;
    subjectToken: string;
  }): Promise<ExchangeTokenResult>;
  generatePkce(): Promise<PkceChallenge>;
  getAccessToken(options?: { clientId?: string; resource?: string }): Promise<string>;
  getCachedIssuer(): string | undefined;
  getCachedJwksUri(): string | undefined;
  getOrCreateDpopClient(): Promise<DpopClient>;
  loadState(): Promise<StoredFirstPartyAuthState | undefined>;
  resumeAuthorization(
    options: ResumeAuthorizationOptions
  ): Promise<AuthorizationCodeResult>;
  saveState(state: StoredFirstPartyAuthState): Promise<void>;
  stepUp(options: StepUpOptions): Promise<AuthenticationResult>;
}

export function detectStepUp(status: number, responseBody: string): void {
  if (status !== 403) {
    return;
  }

  try {
    const body = JSON.parse(responseBody) as StepUpErrorBody;
    if (body.error === "insufficient_authorization" && body.auth_session) {
      throw new StepUpRequiredError(body.auth_session, body.acr_values);
    }
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      throw error;
    }
  }
}

export function createFirstPartyAuth(
  createOptions: CreateFirstPartyAuthOptions
): FirstPartyAuth {
  const discovery = createDiscoveryResolver({
    issuerUrl: createOptions.issuerUrl,
    ...(typeof createOptions.discoveryTtlMs === "number"
      ? { discoveryTtlMs: createOptions.discoveryTtlMs }
      : {}),
  });
  let cachedDpopClient: DpopClient | undefined;

  async function loadState() {
    return createOptions.storage.load();
  }

  async function saveState(state: StoredFirstPartyAuthState) {
    await createOptions.storage.save(state);
  }

  async function updateState(
    updates: Partial<StoredFirstPartyAuthState>
  ): Promise<StoredFirstPartyAuthState> {
    const current = (await loadState()) ?? {};
    const next = { ...current, ...updates };
    await saveState(next);
    return next;
  }

  async function clearTokens() {
    const current = (await loadState()) ?? {};
    const {
      accessToken: _accessToken,
      expiresAt: _expiresAt,
      refreshToken: _refreshToken,
      ...rest
    } = current;
    await saveState(rest);
  }

  async function clearClientRegistration() {
    const current = (await loadState()) ?? {};
    const {
      accessToken: _accessToken,
      clientId: _clientId,
      clientSecret: _clientSecret,
      expiresAt: _expiresAt,
      refreshToken: _refreshToken,
      registrationFingerprint: _registrationFingerprint,
      registrationMethod: _registrationMethod,
      ...rest
    } = current;
    await saveState(rest);
  }

  async function getOrCreateDpopClient(): Promise<DpopClient> {
    if (cachedDpopClient) {
      return cachedDpopClient;
    }

    const state = await loadState();
    const keyPair = state?.dpopKeyPair ?? (await generateDpopKeyPair());
    if (!state?.dpopKeyPair) {
      await updateState({ dpopKeyPair: keyPair });
    }

    cachedDpopClient = await createDpopClientFromKeyPair(keyPair);
    return cachedDpopClient;
  }

  async function ensureClientRegistrationInstance(
    request: ClientRegistrationRequest
  ): Promise<string> {
    const document = await discovery.read();
    if (!document.registration_endpoint) {
      throw new Error(
        "No registration_endpoint in discovery — cannot register via DCR"
      );
    }

    const registrationFingerprint = stableStringify(request.request);
    const state = await loadState();
    if (
      state?.clientId &&
      !request.force &&
      state.registrationMethod === "dcr" &&
      state.registrationFingerprint === registrationFingerprint
    ) {
      return state.clientId;
    }

    const response = await fetch(document.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.request),
    });
    if (!response.ok) {
      throw new Error(`DCR failed: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as {
      client_id?: unknown;
      client_secret?: unknown;
    };
    if (typeof body.client_id !== "string" || body.client_id.length === 0) {
      throw new Error("DCR response missing client_id");
    }

    const {
      accessToken: _accessToken,
      expiresAt: _expiresAt,
      refreshToken: _refreshToken,
      ...rest
    } = state ?? {};

    await saveState({
      ...rest,
      clientId: body.client_id,
      ...(typeof body.client_secret === "string"
        ? { clientSecret: body.client_secret }
        : {}),
      registrationFingerprint,
      registrationMethod: "dcr",
    });

    return body.client_id;
  }

  async function completeOpaqueChallenge(
    dpopClient: DpopClient,
    endpoint: string,
    authSession: string,
    passwordStrategy: PasswordAuthorizationStrategy
  ): Promise<AuthorizationCodeResult> {
    await ensureOpaqueReady();
    const opaqueStart = startOpaqueLogin(passwordStrategy.password);
    const round2 = await postChallenge(dpopClient, endpoint, {
      auth_session: authSession,
      opaque_login_request: opaqueStart.startLoginRequest,
    });

    if (!round2.response.ok) {
      throw new Error(
        `OPAQUE round 2 failed: ${round2.response.status} ${await round2.response.text()}`
      );
    }

    const finishResult = finishOpaqueLogin(
      opaqueStart.clientLoginState,
      readOpaqueLoginResponse(round2.body),
      passwordStrategy.password
    );
    if (!finishResult) {
      throw new Error(
        "OPAQUE finishLogin failed — invalid password or server response"
      );
    }

    const round3 = await postChallenge(dpopClient, endpoint, {
      auth_session: authSession,
      opaque_finish_request: finishResult.finishLoginRequest,
    });
    if (!round3.response.ok) {
      throw new Error(
        `OPAQUE round 3 failed: ${round3.response.status} ${await round3.response.text()}`
      );
    }

    await updateState({ authSession });

    return {
      authSession,
      authorizationCode: readAuthorizationCode(round3.body),
      exportKey: finishResult.exportKey,
      loginMethod: "opaque",
    };
  }

  async function completeWalletChallenge(
    dpopClient: DpopClient,
    endpoint: string,
    authSession: string,
    walletStrategy: WalletAuthorizationStrategy,
    round1Body: Record<string, unknown>
  ): Promise<AuthorizationCodeResult> {
    const signature = await walletStrategy.signTypedData(readTypedData(round1Body));
    const round2 = await postChallenge(dpopClient, endpoint, {
      auth_session: authSession,
      eip712_signature: signature,
    });
    if (!round2.response.ok) {
      throw new Error(
        `EIP-712 round 2 failed: ${round2.response.status} ${await round2.response.text()}`
      );
    }

    await updateState({ authSession });

    return {
      authSession,
      authorizationCode: readAuthorizationCode(round2.body),
      loginMethod: "eip712",
    };
  }

  async function continueAuthorization(
    dpopClient: DpopClient,
    endpoint: string,
    round1: { body: Record<string, unknown>; response: Response },
    strategies: AuthorizationStrategies
  ): Promise<AuthorizationCodeResult> {
    const authSession = readAuthSession(round1.body);
    const challengeType = readChallengeType(round1.body);

    if (challengeType === "opaque") {
      if (!strategies.password) {
        throw new Error("OPAQUE challenge requires a password strategy");
      }
      return completeOpaqueChallenge(
        dpopClient,
        endpoint,
        authSession,
        strategies.password
      );
    }

    if (!strategies.wallet) {
      throw new Error("EIP-712 challenge requires a wallet strategy");
    }

    return completeWalletChallenge(
      dpopClient,
      endpoint,
      authSession,
      strategies.wallet,
      round1.body
    );
  }

  async function authorize(
    authorizeOptions: AuthorizeOptions
  ): Promise<AuthorizationCodeResult> {
    const document = await discovery.read();
    const endpoint = requireChallengeEndpoint(document);
    const dpopClient = await getOrCreateDpopClient();
    const round1 = await postChallenge(dpopClient, endpoint, {
      client_id: authorizeOptions.clientId,
      response_type: "code",
      identifier: authorizeOptions.identifier,
      scope: authorizeOptions.scope,
      code_challenge: authorizeOptions.pkce.codeChallenge,
      code_challenge_method: authorizeOptions.pkce.codeChallengeMethod,
      ...(authorizeOptions.resource ? { resource: authorizeOptions.resource } : {}),
      ...(authorizeOptions.claims ? { claims: authorizeOptions.claims } : {}),
      ...(authorizeOptions.strategies.wallet?.chainId
        ? { chain_id: authorizeOptions.strategies.wallet.chainId }
        : {}),
    });

    if (
      round1.response.status === 400 &&
      round1.body.error === "redirect_to_web" &&
      typeof round1.body.auth_session === "string"
    ) {
      throw new RedirectToWebError(
        round1.body.auth_session,
        typeof round1.body.request_uri === "string"
          ? round1.body.request_uri
          : undefined
      );
    }

    if (round1.response.status !== 401) {
      throw new Error(
        `Expected 401 from challenge endpoint: ${round1.response.status} ${await round1.response.text()}`
      );
    }

    return continueAuthorization(
      dpopClient,
      endpoint,
      round1,
      authorizeOptions.strategies
    );
  }

  async function resumeAuthorization(
    resumeOptions: ResumeAuthorizationOptions
  ): Promise<AuthorizationCodeResult> {
    const document = await discovery.read();
    const endpoint = requireChallengeEndpoint(document);
    const dpopClient = await getOrCreateDpopClient();
    const round1 = await postChallenge(dpopClient, endpoint, {
      auth_session: resumeOptions.authSession,
      ...(resumeOptions.pkce
        ? {
            code_challenge: resumeOptions.pkce.codeChallenge,
            code_challenge_method: resumeOptions.pkce.codeChallengeMethod,
          }
        : {}),
    });

    if (round1.response.ok) {
      await updateState({ authSession: resumeOptions.authSession });
      return {
        authSession: resumeOptions.authSession,
        authorizationCode: readAuthorizationCode(round1.body),
      };
    }

    if (
      round1.response.status === 400 &&
      round1.body.error === "redirect_to_web" &&
      typeof round1.body.auth_session === "string"
    ) {
      throw new RedirectToWebError(
        round1.body.auth_session,
        typeof round1.body.request_uri === "string"
          ? round1.body.request_uri
          : undefined
      );
    }

    if (round1.response.status !== 401) {
      throw new Error(
        `Expected 401 from challenge endpoint: ${round1.response.status} ${await round1.response.text()}`
      );
    }

    return continueAuthorization(
      dpopClient,
      endpoint,
      round1,
      resumeOptions.strategies
    );
  }

  async function exchangeAuthorizationCodeInstance(exchangeOptions: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    resource?: string;
  }): Promise<TokenResult> {
    const document = await discovery.read();
    const dpopClient = await getOrCreateDpopClient();
    const token = await exchangeAuthorizationCode(createOptions.issuerUrl, {
      clientId: exchangeOptions.clientId,
      code: exchangeOptions.code,
      codeVerifier: exchangeOptions.codeVerifier,
      dpopClient,
      redirectUri: exchangeOptions.redirectUri,
      ...(exchangeOptions.resource ? { resource: exchangeOptions.resource } : {}),
      tokenEndpoint: requireTokenEndpoint(document),
    });

    await updateState({
      accessToken: token.accessToken,
      ...(token.accountSub ? { accountSub: token.accountSub } : {}),
      clientId: exchangeOptions.clientId,
      expiresAt: token.expiresAt,
      ...(token.loginHint ? { loginHint: token.loginHint } : {}),
      ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
    });

    return token;
  }

  async function exchangeTokenInstance(exchangeOptions: {
    audience: string;
    clientId: string;
    scope?: string;
    subjectToken: string;
  }): Promise<ExchangeTokenResult> {
    const document = await discovery.read();
    return exchangeToken({
      audience: exchangeOptions.audience,
      clientId: exchangeOptions.clientId,
      dpopClient: await getOrCreateDpopClient(),
      ...(exchangeOptions.scope ? { scope: exchangeOptions.scope } : {}),
      subjectToken: exchangeOptions.subjectToken,
      tokenEndpoint: requireTokenEndpoint(document),
    });
  }

  async function refreshAccessToken(refreshOptions?: {
    clientId?: string;
    resource?: string;
  }): Promise<string> {
    const state = await loadState();
    if (state?.accessToken && state.expiresAt) {
      if (Date.now() + PROACTIVE_REFRESH_MS < state.expiresAt) {
        return state.accessToken;
      }
    }

    if (!state?.refreshToken) {
      throw new TokenExpiredError();
    }

    const clientId = refreshOptions?.clientId ?? state.clientId;
    if (!clientId) {
      throw new TokenExpiredError();
    }

    const document = await discovery.read();
    const tokenEndpoint = requireTokenEndpoint(document);
    const requestBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: state.refreshToken,
      client_id: clientId,
    });
    if (refreshOptions?.resource) {
      requestBody.set("resource", refreshOptions.resource);
    }

    const dpopClient = await getOrCreateDpopClient();
    const { response } = await dpopClient.withNonceRetry(async (nonce) => {
      const proof = await dpopClient.proofFor("POST", tokenEndpoint, undefined, nonce);
      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          DPoP: proof,
        },
        body: requestBody,
      });
      return { response, result: null };
    });

    if (!response.ok) {
      const responseBody = await response.text();
      if (
        responseBody.includes("invalid_client") ||
        responseBody.includes("client not found")
      ) {
        await clearClientRegistration();
      }
      if (responseBody.includes("invalid_grant")) {
        await clearTokens();
      }
      throw new TokenRefreshError(response.status, responseBody);
    }

    const responseBody = (await response.json()) as RefreshTokenResponseBody;
    if (
      typeof responseBody.access_token !== "string" ||
      responseBody.access_token.length === 0
    ) {
      throw new Error("Token refresh response missing access_token");
    }

    const nextExpiresAt =
      Date.now() +
      (typeof responseBody.expires_in === "number"
        ? responseBody.expires_in
        : 3600) * 1000;

    await updateState({
      accessToken: responseBody.access_token,
      expiresAt: nextExpiresAt,
      ...(typeof responseBody.refresh_token === "string"
        ? { refreshToken: responseBody.refresh_token }
        : {}),
    });

    return responseBody.access_token;
  }

  return Object.freeze({
    async authenticate(authenticateOptions: AuthenticationOptions) {
      const pkce = await generatePkceChallenge();
      const authorization = await authorize({
        clientId: authenticateOptions.clientId,
        ...(authenticateOptions.claims
          ? { claims: authenticateOptions.claims }
          : {}),
        identifier: authenticateOptions.identifier,
        pkce,
        ...(authenticateOptions.resource
          ? { resource: authenticateOptions.resource }
          : {}),
        scope: authenticateOptions.scope,
        strategies: authenticateOptions.strategies,
      });
      const token = await exchangeAuthorizationCodeInstance({
        clientId: authenticateOptions.clientId,
        code: authorization.authorizationCode,
        codeVerifier: pkce.codeVerifier,
        redirectUri: authenticateOptions.redirectUri,
        ...(authenticateOptions.resource
          ? { resource: authenticateOptions.resource }
          : {}),
      });
      return buildAuthenticationResult(authorization, token);
    },
    authorize,
    clearClientRegistration,
    clearDiscoveryCache() {
      discovery.clear();
    },
    clearTokens,
    detectStepUp,
    discover() {
      return discovery.read();
    },
    ensureClientRegistration: ensureClientRegistrationInstance,
    exchangeAuthorizationCode: exchangeAuthorizationCodeInstance,
    exchangeToken: exchangeTokenInstance,
    generatePkce: generatePkceChallenge,
    getAccessToken: refreshAccessToken,
    getCachedIssuer() {
      return discovery.peek()?.issuer;
    },
    getCachedJwksUri() {
      return discovery.peek()?.jwks_uri;
    },
    getOrCreateDpopClient,
    loadState,
    resumeAuthorization,
    saveState,
    async stepUp(stepUpOptions: StepUpOptions) {
      const pkce = await generatePkceChallenge();
      const authorization = await resumeAuthorization({
        authSession: stepUpOptions.authSession,
        pkce,
        strategies: stepUpOptions.strategies,
      });
      const token = await exchangeAuthorizationCodeInstance({
        clientId: stepUpOptions.clientId,
        code: authorization.authorizationCode,
        codeVerifier: pkce.codeVerifier,
        redirectUri: stepUpOptions.redirectUri,
        ...(stepUpOptions.resource ? { resource: stepUpOptions.resource } : {}),
      });
      return buildAuthenticationResult(authorization, token);
    },
  } satisfies FirstPartyAuth);
}
