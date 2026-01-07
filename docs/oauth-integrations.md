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
  '["verification"]',
  datetime('now')
);
```

### Minimal authorization flow

1) Redirect user to authorize:
   - `GET /api/auth/oauth2/authorize?client_id=...&redirect_uri=...&scope=openid%20verification&state=...`
2) Exchange code for tokens:
   - `POST /api/auth/oauth2/token`
3) Fetch verification flags:
   - `GET /api/auth/oauth2/userinfo` (requires `openid`)

### Userinfo response (verification claims)

When the access token includes the `verification` scope, `/oauth2/userinfo` returns a `verification` object:

```json
{
  "sub": "user-id",
  "verification": {
    "verified": true,
    "level": "full",
    "checks": {
      "document": true,
      "liveness": true,
      "ageProof": true,
      "docValidityProof": true,
      "nationalityProof": true,
      "faceMatchProof": true
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

## Notes

- Wallet auth (SIWE) is separate and documented in `docs/web3-architecture.md`.
- For OAuth provider metadata endpoints, see `/api/auth/.well-known/*`.
