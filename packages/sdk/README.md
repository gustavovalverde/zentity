# `@zentity/sdk`

Canonical Zentity integration package for agents, relying parties, and installed apps.

## Install

```bash
pnpm add @zentity/sdk
```

## Quickstart

```ts
import { createAgent } from "@zentity/sdk";
import {
  buildLoopbackClientRegistration,
  createFirstPartyAuthFileStorage,
  createInstalledClientAuth,
  deriveAppAudience,
} from "@zentity/sdk/node";
import { createDpopClientFromKeyPair } from "@zentity/sdk/rp";

const issuerUrl = "http://localhost:3000/api/auth";
const installedAuth = createInstalledClientAuth({
  issuerUrl,
  storage: createFirstPartyAuthFileStorage({
    issuerUrl,
    namespace: "example-cli",
  }),
  clientRegistrationRequest: buildLoopbackClientRegistration({
    clientName: "Example CLI",
    grantTypes: ["authorization_code", "refresh_token"],
    scope: "openid email",
  }),
  loginScope: "openid email",
  tokenExchangeAudience: deriveAppAudience(issuerUrl),
});

const session = await installedAuth.ensureOAuthSession();
const agent = createAgent({
  issuerUrl,
  clientId: session.clientId,
  dpopClient: await createDpopClientFromKeyPair(session.dpopKey),
});
```

## Agent Bootstrap

Zentity's token exchange issues only scopes the login token was granted. An installed agent therefore requests the agent bootstrap scopes at sign-in and registers them with its client. It keeps them off its session token with `tokenExchangeScope`, then exchanges the login token for a bootstrap token when it registers its host and sessions.

```ts
import { AGENT_BOOTSTRAP_SCOPES } from "@zentity/sdk/agent-contract";

const sessionScope = "openid email";
const loginScope = [sessionScope, ...AGENT_BOOTSTRAP_SCOPES].join(" ");

const installedAuth = createInstalledClientAuth({
  issuerUrl,
  storage: createFirstPartyAuthFileStorage({
    issuerUrl,
    namespace: "example-agent",
  }),
  clientRegistrationRequest: buildLoopbackClientRegistration({
    clientName: "Example agent",
    grantTypes: [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:token-exchange",
    ],
    scope: loginScope,
  }),
  loginScope,
  tokenExchangeAudience: deriveAppAudience(issuerUrl),
  tokenExchangeScope: sessionScope,
});

const bootstrap = await installedAuth.exchangeLoginToken({
  audience: deriveAppAudience(issuerUrl),
  scope: AGENT_BOOTSTRAP_SCOPES.join(" "),
});
```

## Sub-paths

- `@zentity/sdk`: agent runtime helpers
- `@zentity/sdk/rp`: relying-party token verification, DPoP, proof-of-human, x402 helpers
- `@zentity/sdk/protocol`: shared protocol types such as `AccessTokenClaims`
- `@zentity/sdk/agent-contract`: agent bootstrap scopes and the `agent-configuration` document schema shared by Zentity and agent runtimes
- `@zentity/sdk/fpa`: first-party app auth
- `@zentity/sdk/node`: Node/Bun installed-client helpers and file storage
- `@zentity/sdk/testing`: fixture keys, PoH token mocks, mock issuer

## DPoP Requests

Send DPoP-bound requests through `DpopClient.fetch`. The client signs a proof for each attempt and handles server nonces (RFC 9449 §8 and §9).

```ts
import { createDpopClient } from "@zentity/sdk/rp";

const dpopClient = await createDpopClient();

const tokenResponse = await dpopClient.fetch(tokenEndpoint, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials" }),
});

const userInfo = await dpopClient.fetch(userInfoEndpoint, { accessToken });
```

The client handles nonces as follows:

- It remembers the latest `DPoP-Nonce` header from each origin, on success and error responses, and puts that nonce in the next proof for the origin.
- It retries a request once when the server answers `use_dpop_nonce`. An authorization server sends this error in a 400 JSON body. A resource server sends it in a 401 `WWW-Authenticate` header.
- It returns every other response unchanged, including errors such as `invalid_grant` that carry a `DPoP-Nonce` header.

With `accessToken` set, the proof carries the token hash (`ath`) and the request carries `Authorization: DPoP <accessToken>`.

The retry sends the request body again. Pass a body that can be read twice, such as a string or `URLSearchParams`, not a stream.

Proofs use the request URL without its query and fragment as `htu` (RFC 9449 §4.2). The client drops a fragment instead of failing, because a fragment is never sent on the wire, so the proof still names the same origin and path as the request.

Each client keeps its own nonces. When a server requires nonces, a new client needs one extra round trip to learn the nonce. Reuse one client per key instead of creating one per request.

## Verifying Tokens and DPoP Proofs

`createOpenIdTokenVerifier` verifies a signed token against the issuer's discovery document and JWKS. It checks the signature and issuer. Pass the audience you expect.

```ts
import { createOpenIdTokenVerifier } from "@zentity/sdk/rp";

const verifier = createOpenIdTokenVerifier({ issuerUrl });
const { payload } = await verifier.verify(accessToken, {
  audience: "https://rp.example",
});
```

This checks the token, not the request. A DPoP-bound access token (`cnf.jkt` set) must also arrive with a valid DPoP proof, so a relying party that accepts DPoP-bound tokens verifies the proof as RFC 9449 §4.3 requires:

- The proof is an ES256 `dpop+jwt` signed with the key in its own `jwk` header.
- `htm` and `htu` match the request method and URL without query and fragment, and `iat` is recent.
- `ath` is the SHA-256 hash of the access token, and the key's thumbprint equals the token's `cnf.jkt`.
- The `jti` has not been seen before, so a captured proof cannot be replayed.
- When the server requires nonces (RFC 9449 §8 and §9), the proof carries a current server-provided nonce.

The SDK signs DPoP proofs but does not verify them. Any RFC 9449 verifier works. With Better Auth, `verifyAccessTokenRequest` and `verifyDpopProof` from `@better-auth/core/oauth2` cover the first four checks, including replay protection, from the stable 1.7 line onward. Server-provided nonces need `@better-auth/core` 1.8.0-beta.8 or later, because stable 1.7 has no nonce support. A verifier must stay strict about `htu`: it rejects a proof whose `htu` carries a fragment, even though this client never produces one.

## Proof of Human

`requestProofOfHumanToken` asks the issuer for a proof-of-human token with a DPoP-bound access token. `createProofOfHumanTokenVerifier` checks the issuer signature and returns the claims. `identityStrengthTier` maps the identity strength to a number for threshold checks.

```ts
import {
  createProofOfHumanTokenVerifier,
  identityStrengthTier,
  requestProofOfHumanToken,
} from "@zentity/sdk/rp";

// `dpopClient` must hold the key the access token is bound to (its `cnf.jkt`).
// The issuer rejects a proof signed with any other key.
const result = await requestProofOfHumanToken({
  accessToken,
  dpopClient,
  proofOfHumanUrl: `${issuerUrl}/oauth2/proof-of-human`,
});

if (result.ok) {
  const verifier = createProofOfHumanTokenVerifier({
    issuer: issuerUrl,
    jwksUrl,
  });
  const { poh } = await verifier.verify(result.token);
  const humanWithDocument = poh.humanity.proven && identityStrengthTier(poh) >= 1;
}
```

Read `result.unverifiedClaims` only to decide what to show. Rely on the verified `poh` claims for access decisions.

The proof-of-human token is bound to the presenter's DPoP key through `cnf.jkt`. A service that receives the token from someone else must check that `cnf.jkt` equals the thumbprint of the key that signed the DPoP proof sent with it. Without that check, anyone who captures the token can replay it.

## x402 Payment Required

`createPaymentRequired` builds the x402 v2 `402` response with the `PAYMENT-REQUIRED` header. Declare Zentity's compliance requirement in `extensions.zentity`.

```ts
import { createPaymentRequired } from "@zentity/sdk/rp";

return createPaymentRequired({
  accepts: {
    scheme: "exact",
    network: "eip155:84532",
    payTo,
    amount: "1",
    asset,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  },
  resource: { url: "/api/premium" },
  extensions: { zentity: { minComplianceLevel: 2, pohIssuer: issuerUrl } },
});
```

## x402 Selection

`createX402Fetch()` selects the first advertised `PAYMENT-REQUIRED.accepts`
entry for the retry and exposes it as `context.selectedPaymentRequirement`.
Callers that enforce amount or network bounds should validate that selected
requirement.

## Error Codes

`@zentity/sdk/protocol` exports the stable `SdkErrorCode` union. Runtime
errors that carry one of these codes expose it on their `code` property.

- `compliance_insufficient`
- `invalid_did_key_format`
- `token_refresh_failed`
- `use_dpop_nonce`

## Requirements

Node.js 24 or later. The package ships ESM and CommonJS builds with types for both, and the exports map resolves every sub-path. Resolve types with `moduleResolution` set to `bundler`, `node16`, or `nodenext`; the classic `node10` mode cannot read sub-path exports. The CommonJS build loads `jose`, which is ESM-only, so type-check CommonJS consumers with `module: "nodenext"`.

## Build Contract

Consume `@zentity/sdk` through its package exports, which point at `dist/`. The source tree uses bundler-mode TypeScript imports; downstream projects should not run `tsx`, `vitest`, or direct imports against `packages/sdk/src/*` unless their own tsconfig also uses bundler resolution.
