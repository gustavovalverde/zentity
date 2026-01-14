# OAuth Integrations (Provider + Generic OAuth)

This doc summarizes the two OAuth directions in Zentity:

1) **OAuth Provider** — Zentity acts as an authorization server for partners.
2) **Generic OAuth** — Zentity signs in with external OAuth/OIDC providers.

## OAuth Provider (Zentity as authorization server)

The OAuth Provider plugin is enabled in `apps/web/src/lib/auth/auth.ts` and exposes endpoints under `/api/auth/oauth2/*`.

### Minimal client setup

OAuth clients are stored in the `oauth_client` table (`apps/web/src/lib/db/schema/oauth-provider.ts`). The minimal required fields are:

- `client_id`
- `redirect_uris` (JSON array)

Example (SQLite):

```sql
INSERT INTO oauth_client (client_id, redirect_uris, scopes, created_at)
VALUES (
  'partner-client-id',
  '["https://partner.example.com/callback"]',
  '["openid","profile","email","vc:identity"]',
  datetime('now')
);
```

### Minimal authorization flow

1) Redirect user to authorize:
   - `GET /api/auth/oauth2/authorize?client_id=...&redirect_uri=...&scope=openid%20profile%20email&state=...`
2) Exchange code for tokens:
   - `POST /api/auth/oauth2/token`
3) Fetch verified claims (OIDC4IDA):
   - `GET /api/auth/oauth2/userinfo` (requires `openid`)

### Userinfo response (verified claims)

When identity assurance data is available, `/oauth2/userinfo` includes a `verified_claims` object (OIDC4IDA):

```json
{
  "sub": "user-id",
  "verified_claims": {
    "verification": {
      "trust_framework": "zentity",
      "assurance_level": "full",
      "time": "2026-01-02T00:00:00.000Z"
    },
    "claims": {
      "verification_level": "full",
      "verified": true
    }
  }
}
```

Full provider flow is documented in `docs/rp-redirect-flow.md`.

## Generic OAuth (Zentity as OAuth client)

Generic OAuth providers are configured via the `GENERIC_OAUTH_PROVIDERS` env var. The app parses this JSON array in `apps/web/src/lib/auth/auth.ts`.

### Example configuration

```json
[
  {
    "providerId": "partner-oidc",
    "discoveryUrl": "https://partner.example.com/.well-known/openid-configuration",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "scopes": ["openid", "email", "profile"],
    "pkce": true
  }
]
```

Set it in `.env.local`:

```env
GENERIC_OAUTH_PROVIDERS='[{"providerId":"partner-oidc","discoveryUrl":"https://partner.example.com/.well-known/openid-configuration","clientId":"...","clientSecret":"...","scopes":["openid","email","profile"],"pkce":true}]'
```

### Sign in flow

- Start sign-in via Better Auth:
  - `authClient.signIn.oauth2({ providerId: "partner-oidc" })`
  - (or `POST /api/auth/sign-in/oauth2` with `{ providerId }`)
- Better Auth handles the callback at:
  - `GET /api/auth/oauth2/callback/partner-oidc`

If the user is already signed in, Better Auth can link the provider account via `authClient.oauth2.link` (optional).

## OIDC4VCI (Credential Issuance)

Zentity acts as a Verifiable Credential Issuer following the OIDC4VCI specification.

### Issuer metadata

- `GET /.well-known/openid-credential-issuer`
- `GET /.well-known/oauth-authorization-server`

### Credential endpoint

- `POST /api/auth/oidc4vci/credential`

### Pre-authorized code flow

1. User completes verification
2. Server creates credential offer with pre-authorized code
3. Wallet scans QR or follows deep link
4. Wallet exchanges code for access token
5. Wallet requests credential with holder binding proof

### Supported credential types

- `zentity_identity` (vct: `urn:zentity:credential:identity`)
- Format: `dc+sd-jwt` (SD-JWT VC)

### Derived claims

Credentials contain only derived claims (no raw PII):

- `verification_level` (`none` | `basic` | `full`)
- `verified`, `document_verified`, `liveness_verified`, `face_match_verified`
- `age_proof_verified`, `doc_validity_proof_verified`, `nationality_proof_verified`
- `policy_version`, `issuer_id`, `verification_time`

## OIDC4VP (Credential Presentation)

Zentity can act as a verifier requesting presentations from wallets.

### Verifier endpoints

- `POST /api/auth/oidc4vp/verify` — Create presentation request
- `POST /api/auth/oidc4vp/response` — Submit presentation

### Presentation definition

Verifiers specify required claims via Presentation Exchange (PEX) format.

### Holder binding

Presentations include a proof JWT demonstrating possession of the holder's private key. The verifier validates:

- Issuer signature on the credential
- Holder binding (`cnf.jkt` thumbprint)
- Required claims are present

See [SSI Architecture](ssi-architecture.md) for the complete model.

## Notes

- Wallet auth (SIWE) is separate and documented in `docs/web3-architecture.md`.
- For OAuth provider metadata endpoints, see `/api/auth/.well-known/*`.
