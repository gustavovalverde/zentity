---
"@zentity/sdk": minor
---

Add `InstalledClientAuth.exchangeLoginToken({ audience, scope })`, which exchanges the stored login token, refreshed when needed, for a DPoP-bound access token limited to `scope`, such as an agent bootstrap token. Zentity's token exchange issues only scopes the login token was granted, so an installed agent requests the agent bootstrap scopes in `loginScope` and in its client registration.
