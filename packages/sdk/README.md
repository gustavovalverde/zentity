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

## Error Codes

`@zentity/sdk/protocol` exports the stable `ZentityErrorCode` union:

- `compliance_insufficient`
- `invalid_did_key_format`
- `token_refresh_failed`
- `use_dpop_nonce`

## Release Status

`0.1.0` is the first public release line. The package is publish-ready in this repo; public npm release still requires npm scope credentials in CI.

## Build Contract

Consume `@zentity/sdk` through its package exports, which point at `dist/`. The source tree uses bundler-mode TypeScript imports; downstream projects should not run `tsx`, `vitest`, or direct imports against `packages/sdk/src/*` unless their own tsconfig also uses bundler resolution.
