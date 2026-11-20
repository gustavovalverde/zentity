import {
  client as opaqueClient,
  ready as opaqueReady,
} from "@serenity-kit/opaque";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { z } from "zod";
import type { SdkErrorCode } from "../protocol/claims";
import {
  createDpopClientFromKeyPair,
  type DpopClient,
  type DpopKeyPair,
  generateDpopKeyPair,
} from "../rp/dpop-client";
import { requestTokenEndpoint } from "../rp/token-request";
import {
  createDiscoveryResolver,
  type FirstPartyAuthDiscoveryDocument,
} from "./discovery";
import {
  type ExchangeTokenResult,
  exchangeAuthorizationCode,
  exchangeToken,
  type TokenResult,
} from "./oauth";
import { generatePkceChallenge, type PkceChallenge } from "./pkce";

type MaybePromise<T> = Promise<T> | T;

const PROACTIVE_REFRESH_MS = 60_000;
const SCOPE_SEPARATOR_RE = /\s+/;

export interface StoredFirstPartyAuthState {
  accessToken?: string;
  accountSub?: string;
  authSession?: string;
  clientAuthKeyPair?: { privateJwk: JWK; publicJwk: JWK };
  clientAuthMethod?: "private_key_jwt";
  clientId?: string;
  clientSecret?: string;
  dpopKeyPair?: DpopKeyPair;
  expiresAt?: number;
  loginHint?: string;
  refreshToken?: string;
  registrationFingerprint?: string;
  registrationMethod?: "cimd" | "dcr";
  /** The scopes granted to `accessToken`. */
  scopes?: string[];
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
  privateKeyJwt?: boolean;
  request: Record<string, unknown>;
}

export interface PasswordAuthorizationStrategy {
  password: string;
}

export interface WalletAuthorizationStrategy {
  chainId?: number;
  /**
   * Signs the server's Sign-In with Ethereum (EIP-4361) message with EIP-191
   * `personal_sign`, as viem's `account.signMessage({ message })` does.
   */
  signMessage(message: string): MaybePromise<string>;
}

export interface AuthorizationStrategies {
  password?: PasswordAuthorizationStrategy;
  wallet?: WalletAuthorizationStrategy;
}

export interface AuthorizeOptions {
  claims?: string;
  clientId: string;
  /** The user's email address or wallet address, sent as `login_hint`. */
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
  /** The user's email address or wallet address, sent as `login_hint`. */
  identifier: string;
  resource?: string;
  scope: string;
  strategies: AuthorizationStrategies;
}

export interface StepUpOptions {
  authSession: string;
  clientId: string;
  resource?: string;
  strategies: AuthorizationStrategies;
}

export interface AuthorizationCodeResult {
  authorizationCode: string;
  authSession: string;
  exportKey?: string;
  loginMethod?: "eip712" | "opaque";
}

export interface AuthenticationResult extends TokenResult {
  exportKey?: string;
  loginMethod?: "eip712" | "opaque";
}

interface RefreshTokenResponseBody {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
}

interface StepUpErrorBody {
  acr_values?: string;
  auth_session?: string;
  error: string;
  error_description?: string;
}

export function stableStringify(value: unknown): string {
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

// Challenge responses are read leniently: a field of the wrong type is
// treated as absent, and each step reports the field it needs.
const optionalField = <T extends z.ZodType>(schema: T) =>
  schema.optional().catch(undefined);

const challengeBodySchema = z.object({
  acr_values: optionalField(z.string()),
  auth_session: optionalField(z.string()),
  authorization_code: optionalField(z.string()),
  challenge_type: optionalField(z.string()),
  error: optionalField(z.string()),
  max_age: optionalField(z.number()),
  message: optionalField(z.string()),
  opaque_login_response: optionalField(z.string()),
});

type ChallengeBody = z.infer<typeof challengeBodySchema>;

interface ChallengeRound {
  body: ChallengeBody;
  response: Response;
}

async function parseChallengeBody(response: Response): Promise<ChallengeBody> {
  const json = await response.json().catch(() => undefined);
  return challengeBodySchema.safeParse(json).data ?? {};
}

function required<T extends string | object>(
  value: T | undefined,
  message: string
): T {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function requireChallengeEndpoint(
  document: FirstPartyAuthDiscoveryDocument
): string {
  if (!document.authorization_challenge_endpoint) {
    throw new Error(
      "Discovery response missing authorization_challenge_endpoint"
    );
  }
  return document.authorization_challenge_endpoint;
}

function requireTokenEndpoint(
  document: FirstPartyAuthDiscoveryDocument
): string {
  return document.token_endpoint;
}

function readAuthorizationCode(body: ChallengeBody): string {
  return required(
    body.authorization_code,
    "Authorization response missing authorization_code"
  );
}

function readChallengeType(body: ChallengeBody): "opaque" | "siwe" {
  if (body.challenge_type === "opaque" || body.challenge_type === "siwe") {
    return body.challenge_type;
  }
  throw new Error(`Unsupported challenge type: ${String(body.challenge_type)}`);
}

type PostChallenge = (body: Record<string, string>) => Promise<ChallengeRound>;

function registeredClientAuthentication(
  state: StoredFirstPartyAuthState | undefined,
  clientId: string | undefined,
  issuer: string
) {
  if (
    !clientId ||
    state?.clientId !== clientId ||
    state.clientAuthMethod !== "private_key_jwt" ||
    !state.clientAuthKeyPair
  ) {
    return;
  }

  return {
    clientId,
    privateJwk: state.clientAuthKeyPair.privateJwk,
    signingAlgorithm: "ES256" as const,
    clientAssertionAudience: issuer,
  };
}

/**
 * Reads a challenge-endpoint answer. A 200 carries the authorization code
 * and a 403 `insufficient_authorization` with `challenge_type` the next
 * challenge. A 403 `redirect_to_web` throws {@link RedirectToWebError}, and a
 * 403 `insufficient_authorization` without `challenge_type` throws
 * {@link StepUpRequiredError}: the user is signed in, but the request must
 * wait until it can be met, for example a higher assurance tier.
 */
async function readChallengeRound(
  round: ChallengeRound,
  step: string
): Promise<
  | { authorizationCode: string; type: "code" }
  | { body: ChallengeBody; type: "challenge" }
> {
  const { body, response } = round;
  if (response.ok) {
    return { authorizationCode: readAuthorizationCode(body), type: "code" };
  }
  if (response.status === 403) {
    if (body.error === "redirect_to_web") {
      throw new RedirectToWebError({
        ...(body.auth_session ? { authSession: body.auth_session } : {}),
        ...(body.acr_values ? { acrValues: body.acr_values } : {}),
        ...(body.max_age === undefined ? {} : { maxAge: body.max_age }),
      });
    }
    if (body.error === "insufficient_authorization" && body.auth_session) {
      if (body.challenge_type === undefined) {
        throw new StepUpRequiredError(body.auth_session, body.acr_values);
      }
      return { body, type: "challenge" };
    }
  }
  throw new Error(
    `${step} failed: ${response.status} ${await response.text()}`
  );
}

async function requireChallenge(
  round: ChallengeRound,
  step: string
): Promise<ChallengeBody> {
  const outcome = await readChallengeRound(round, step);
  if (outcome.type !== "challenge") {
    throw new Error(`${step} returned an authorization code too early`);
  }
  return outcome.body;
}

async function requireAuthorizationCode(
  round: ChallengeRound,
  step: string
): Promise<string> {
  const outcome = await readChallengeRound(round, step);
  if (outcome.type !== "code") {
    throw new Error(`${step} returned another challenge`);
  }
  return outcome.authorizationCode;
}

function buildAuthenticationResult(
  authorization: AuthorizationCodeResult,
  token: TokenResult
): AuthenticationResult {
  return {
    ...token,
    ...(authorization.exportKey ? { exportKey: authorization.exportKey } : {}),
    ...(authorization.loginMethod
      ? { loginMethod: authorization.loginMethod }
      : {}),
  };
}

/**
 * The user must continue in a browser authorization request. `acrValues` and
 * `maxAge` say what that request must ask for when the user signs in again
 * for a step-up. `authSession` is set when the server keeps the sign-in.
 */
export class RedirectToWebError extends Error {
  readonly acrValues?: string;
  readonly authSession?: string;
  readonly maxAge?: number;

  constructor(
    options: { acrValues?: string; authSession?: string; maxAge?: number } = {}
  ) {
    super("The user must continue in the browser");
    this.name = "RedirectToWebError";
    if (options.acrValues) {
      this.acrValues = options.acrValues;
    }
    if (options.authSession) {
      this.authSession = options.authSession;
    }
    if (options.maxAge !== undefined) {
      this.maxAge = options.maxAge;
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
    /** Omit for a code from the Authorization Challenge Endpoint. */
    redirectUri?: string;
    resource?: string;
  }): Promise<TokenResult>;
  exchangeToken(options: {
    audience: string;
    clientId: string;
    /** For a confidential client: sent as `client_secret_basic`. */
    clientSecret?: string;
    scope?: string;
    subjectToken: string;
  }): Promise<ExchangeTokenResult>;
  generatePkce(): Promise<PkceChallenge>;
  getAccessToken(options?: {
    clientId?: string;
    resource?: string;
  }): Promise<string>;
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

  async function getOrCreateClientAuthKeyPair(
    enabled: boolean,
    state: StoredFirstPartyAuthState | undefined
  ) {
    if (!enabled) {
      return;
    }
    if (state?.clientAuthKeyPair) {
      return state.clientAuthKeyPair;
    }

    const keys = await generateKeyPair("ES256", { extractable: true });
    const keyPair = {
      privateJwk: await exportJWK(keys.privateKey),
      publicJwk: await exportJWK(keys.publicKey),
    };
    return keyPair;
  }

  async function clearTokens() {
    const current = (await loadState()) ?? {};
    const {
      accessToken: _accessToken,
      expiresAt: _expiresAt,
      refreshToken: _refreshToken,
      scopes: _scopes,
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
      scopes: _scopes,
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

    const state = await loadState();
    const authKeyPair = await getOrCreateClientAuthKeyPair(
      request.privateKeyJwt ?? false,
      state
    );
    const registrationRequest =
      request.privateKeyJwt && authKeyPair
        ? {
            ...request.request,
            token_endpoint_auth_method: "private_key_jwt",
            token_endpoint_auth_signing_alg: "ES256",
            jwks: { keys: [{ ...authKeyPair.publicJwk, alg: "ES256" }] },
          }
        : request.request;
    const registrationFingerprint = stableStringify(registrationRequest);
    if (
      state?.clientId &&
      !request.force &&
      state.registrationMethod === "dcr" &&
      state.registrationFingerprint === registrationFingerprint
    ) {
      if (request.privateKeyJwt && authKeyPair) {
        if (state.clientAuthMethod !== "private_key_jwt") {
          await updateState({
            clientAuthKeyPair: authKeyPair,
            clientAuthMethod: "private_key_jwt",
          });
        }
      } else if (state.clientAuthKeyPair || state.clientAuthMethod) {
        const {
          clientAuthKeyPair: _clientAuthKeyPair,
          clientAuthMethod: _clientAuthMethod,
          ...publicState
        } = state;
        await saveState(publicState);
      }
      return state.clientId;
    }

    const response = await fetch(document.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registrationRequest),
    });
    if (!response.ok) {
      throw new Error(
        `DCR failed: ${response.status} ${await response.text()}`
      );
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
      clientAuthKeyPair: _clientAuthKeyPair,
      clientAuthMethod: _clientAuthMethod,
      clientSecret: _clientSecret,
      expiresAt: _expiresAt,
      refreshToken: _refreshToken,
      ...rest
    } = state ?? {};

    await saveState({
      ...rest,
      clientId: body.client_id,
      ...(request.privateKeyJwt && authKeyPair
        ? {
            clientAuthKeyPair: authKeyPair,
            clientAuthMethod: "private_key_jwt" as const,
          }
        : {}),
      ...(typeof body.client_secret === "string"
        ? { clientSecret: body.client_secret }
        : {}),
      registrationFingerprint,
      registrationMethod: "dcr",
    });

    return body.client_id;
  }

  async function createChallengeSender(
    clientId?: string
  ): Promise<PostChallenge> {
    const document = await discovery.read();
    const endpoint = requireChallengeEndpoint(document);
    const dpopClient = await getOrCreateDpopClient();
    const state = await loadState();
    const client = registeredClientAuthentication(
      state,
      clientId ?? state?.clientId,
      document.issuer
    );

    return async (fields) => {
      if (client || !fields.auth_session) {
        const { response, body } = await requestTokenEndpoint(
          dpopClient,
          endpoint,
          new URLSearchParams(fields),
          client
        );
        return {
          response,
          body: challengeBodySchema.safeParse(body).data ?? {},
        };
      }
      const response = await dpopClient.fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      return { response, body: await parseChallengeBody(response.clone()) };
    };
  }

  async function completeOpaqueChallenge(
    postChallenge: PostChallenge,
    authSession: string,
    passwordStrategy: PasswordAuthorizationStrategy
  ): Promise<AuthorizationCodeResult> {
    await opaqueReady;
    const opaqueStart = opaqueClient.startLogin({
      password: passwordStrategy.password,
    });
    const round2 = await requireChallenge(
      await postChallenge({
        auth_session: authSession,
        opaque_login_request: opaqueStart.startLoginRequest,
      }),
      "OPAQUE round 2"
    );

    const finishResult = opaqueClient.finishLogin({
      clientLoginState: opaqueStart.clientLoginState,
      loginResponse: required(
        round2.opaque_login_response,
        "OPAQUE response missing opaque_login_response"
      ),
      password: passwordStrategy.password,
    });
    if (!finishResult) {
      throw new Error(
        "OPAQUE finishLogin failed — invalid password or server response"
      );
    }

    const authorizationCode = await requireAuthorizationCode(
      await postChallenge({
        auth_session: authSession,
        opaque_finish_request: finishResult.finishLoginRequest,
      }),
      "OPAQUE round 3"
    );

    await updateState({ authSession });

    return {
      authSession,
      authorizationCode,
      exportKey: finishResult.exportKey,
      loginMethod: "opaque",
    };
  }

  async function completeWalletChallenge(
    postChallenge: PostChallenge,
    authSession: string,
    walletStrategy: WalletAuthorizationStrategy,
    round1Body: ChallengeBody
  ): Promise<AuthorizationCodeResult> {
    const signature = await walletStrategy.signMessage(
      required(round1Body.message, "SIWE challenge missing message")
    );
    const authorizationCode = await requireAuthorizationCode(
      await postChallenge({
        auth_session: authSession,
        siwe_signature: signature,
      }),
      "SIWE round 2"
    );

    await updateState({ authSession });

    return {
      authSession,
      authorizationCode,
      loginMethod: "eip712",
    };
  }

  async function continueAuthorization(
    postChallenge: PostChallenge,
    round1Body: ChallengeBody,
    strategies: AuthorizationStrategies
  ): Promise<AuthorizationCodeResult> {
    const authSession = required(
      round1Body.auth_session,
      "Challenge response missing auth_session"
    );
    const challengeType = readChallengeType(round1Body);

    if (challengeType === "opaque") {
      if (!strategies.password) {
        throw new Error("OPAQUE challenge requires a password strategy");
      }
      return completeOpaqueChallenge(
        postChallenge,
        authSession,
        strategies.password
      );
    }

    if (!strategies.wallet) {
      throw new Error("SIWE challenge requires a wallet strategy");
    }

    return completeWalletChallenge(
      postChallenge,
      authSession,
      strategies.wallet,
      round1Body
    );
  }

  async function authorize(
    authorizeOptions: AuthorizeOptions
  ): Promise<AuthorizationCodeResult> {
    if (
      authorizeOptions.claims &&
      !authorizeOptions.scope.split(SCOPE_SEPARATOR_RE).includes("openid")
    ) {
      throw new TypeError("claims requires scope to include openid");
    }

    const postChallenge = await createChallengeSender(
      authorizeOptions.clientId
    );
    const round1 = await requireChallenge(
      await postChallenge({
        client_id: authorizeOptions.clientId,
        response_type: "code",
        login_hint: authorizeOptions.identifier,
        scope: authorizeOptions.scope,
        code_challenge: authorizeOptions.pkce.codeChallenge,
        code_challenge_method: authorizeOptions.pkce.codeChallengeMethod,
        ...(authorizeOptions.resource
          ? { resource: authorizeOptions.resource }
          : {}),
        ...(authorizeOptions.claims ? { claims: authorizeOptions.claims } : {}),
        ...(authorizeOptions.strategies.wallet?.chainId
          ? { chain_id: String(authorizeOptions.strategies.wallet.chainId) }
          : {}),
      }),
      "Authorization challenge"
    );

    return continueAuthorization(
      postChallenge,
      round1,
      authorizeOptions.strategies
    );
  }

  async function resumeAuthorization(
    resumeOptions: ResumeAuthorizationOptions,
    clientId?: string
  ): Promise<AuthorizationCodeResult> {
    const postChallenge = await createChallengeSender(clientId);
    const outcome = await readChallengeRound(
      await postChallenge({
        auth_session: resumeOptions.authSession,
        ...(resumeOptions.pkce
          ? {
              code_challenge: resumeOptions.pkce.codeChallenge,
              code_challenge_method: resumeOptions.pkce.codeChallengeMethod,
            }
          : {}),
      }),
      "Authorization challenge"
    );

    if (outcome.type === "code") {
      await updateState({ authSession: resumeOptions.authSession });
      return {
        authSession: resumeOptions.authSession,
        authorizationCode: outcome.authorizationCode,
      };
    }

    return continueAuthorization(
      postChallenge,
      outcome.body,
      resumeOptions.strategies
    );
  }

  async function exchangeAuthorizationCodeInstance(exchangeOptions: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri?: string;
    resource?: string;
  }): Promise<TokenResult> {
    const document = await discovery.read();
    const state = await loadState();
    const dpopClient = await getOrCreateDpopClient();
    const token = await exchangeAuthorizationCode(createOptions.issuerUrl, {
      clientId: exchangeOptions.clientId,
      code: exchangeOptions.code,
      codeVerifier: exchangeOptions.codeVerifier,
      dpopClient,
      ...registeredClientAuthentication(
        state,
        exchangeOptions.clientId,
        document.issuer
      ),
      ...(exchangeOptions.redirectUri
        ? { redirectUri: exchangeOptions.redirectUri }
        : {}),
      ...(exchangeOptions.resource
        ? { resource: exchangeOptions.resource }
        : {}),
      tokenEndpoint: requireTokenEndpoint(document),
    });

    await updateState({
      accessToken: token.accessToken,
      ...(token.accountSub ? { accountSub: token.accountSub } : {}),
      ...(token.authSession ? { authSession: token.authSession } : {}),
      clientId: exchangeOptions.clientId,
      expiresAt: token.expiresAt,
      ...(token.loginHint ? { loginHint: token.loginHint } : {}),
      ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
      scopes: token.scopes,
    });

    return token;
  }

  async function exchangeTokenInstance(exchangeOptions: {
    audience: string;
    clientId: string;
    clientSecret?: string;
    scope?: string;
    subjectToken: string;
  }): Promise<ExchangeTokenResult> {
    const document = await discovery.read();
    const state = await loadState();
    return exchangeToken({
      audience: exchangeOptions.audience,
      clientId: exchangeOptions.clientId,
      ...(exchangeOptions.clientSecret === undefined
        ? {}
        : { clientSecret: exchangeOptions.clientSecret }),
      ...registeredClientAuthentication(
        state,
        exchangeOptions.clientId,
        document.issuer
      ),
      dpopClient: await getOrCreateDpopClient(),
      ...(exchangeOptions.scope ? { scope: exchangeOptions.scope } : {}),
      subjectToken: exchangeOptions.subjectToken,
      tokenEndpoint: requireTokenEndpoint(document),
      ...(document.userinfo_endpoint
        ? { userInfoEndpoint: document.userinfo_endpoint }
        : {}),
    });
  }

  async function refreshAccessToken(refreshOptions?: {
    clientId?: string;
    resource?: string;
  }): Promise<string> {
    const state = await loadState();
    if (
      state?.accessToken &&
      state.expiresAt &&
      Date.now() + PROACTIVE_REFRESH_MS < state.expiresAt
    ) {
      return state.accessToken;
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
    });
    if (refreshOptions?.resource) {
      requestBody.set("resource", refreshOptions.resource);
    }

    const dpopClient = await getOrCreateDpopClient();
    const { response, body: tokenResponseBody } = await requestTokenEndpoint(
      dpopClient,
      tokenEndpoint,
      requestBody,
      {
        clientId,
        ...registeredClientAuthentication(state, clientId, document.issuer),
        ...(state.clientSecret ? { clientSecret: state.clientSecret } : {}),
      }
    );

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

    const responseBody = tokenResponseBody as RefreshTokenResponseBody;
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
        : 3600) *
        1000;

    await updateState({
      accessToken: responseBody.access_token,
      expiresAt: nextExpiresAt,
      ...(typeof responseBody.refresh_token === "string"
        ? { refreshToken: responseBody.refresh_token }
        : {}),
      ...(typeof responseBody.scope === "string"
        ? { scopes: responseBody.scope.split(" ").filter(Boolean) }
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
    getOrCreateDpopClient,
    loadState,
    resumeAuthorization,
    saveState,
    async stepUp(stepUpOptions: StepUpOptions) {
      const pkce = await generatePkceChallenge();
      const authorization = await resumeAuthorization(
        {
          authSession: stepUpOptions.authSession,
          pkce,
          strategies: stepUpOptions.strategies,
        },
        stepUpOptions.clientId
      );
      const token = await exchangeAuthorizationCodeInstance({
        clientId: stepUpOptions.clientId,
        code: authorization.authorizationCode,
        codeVerifier: pkce.codeVerifier,
        ...(stepUpOptions.resource ? { resource: stepUpOptions.resource } : {}),
      });
      return buildAuthenticationResult(authorization, token);
    },
  } satisfies FirstPartyAuth);
}
