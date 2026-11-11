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

## Sub-paths

- `@zentity/sdk`: agent runtime helpers
- `@zentity/sdk/rp`: relying-party token verification, DPoP, x402 helpers
- `@zentity/sdk/protocol`: shared protocol types such as `AccessTokenClaims`
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

Proofs use the request URL without its query as `htu`. A URL with a fragment is rejected.

Each client keeps its own nonces. When a server requires nonces, a new client needs one extra round trip to learn the nonce. Reuse one client per key instead of creating one per request.

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

## Release Status

The package is ready for internal workspace consumers. Public npm release is
deferred until the PRD-27 publish gate is green across PRD-37, PRD-38, and
PRD-39.

## Build Contract

Consume `@zentity/sdk` through its package exports, which point at `dist/`. The source tree uses bundler-mode TypeScript imports; downstream projects should not run `tsx`, `vitest`, or direct imports against `packages/sdk/src/*` unless their own tsconfig also uses bundler resolution.
