---
"@zentity/sdk": minor
---

Add `InstalledClientAuth.exchangeLoginToken({ audience, scope })`, which exchanges the stored login token for a DPoP-bound access token limited to `scope`, such as an agent bootstrap token.

Zentity's token exchange now issues only scopes the login token was granted, and never `offline_access`. An installed agent must request the agent bootstrap scopes in `loginScope` and in its client registration, keep them off its session token with `tokenExchangeScope`, and get its bootstrap token from `exchangeLoginToken` instead of exchanging its session token.
