---
"@zentity/sdk": minor
---

`createInstalledClientAuth` no longer exchanges the login token. The session's `accessToken` is the login token, and `accountSub` is the subject UserInfo returns for it. The `tokenExchangeAudience` and `tokenExchangeScope` options are removed; Zentity refuses an exchange that adds scopes, so an agent requests the bootstrap scopes (`AGENT_BOOTSTRAP_SCOPES`) at sign-in instead. Users of an installed client sign in again once, because a stored login token from an earlier version lacks those scopes.

`exchangeToken`, `beginCibaApproval`, `pollCibaTokenOnce`, and `requestCibaApproval` accept a `clientSecret`, sent as `client_secret_basic`, for a confidential client such as the MCP HTTP server. The first-party auth state now stores the `scopes` granted to its access token.
