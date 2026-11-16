---
"@zentity/sdk": minor
---

`resolveOAuthIdentity`, `exchangeAuthorizationCode`, and `exchangeToken` read the account subject only from UserInfo or the ID token, never from the access token. A Zentity JWT access token's `sub` is pairwise for its audience, so it is not the subject the client knows the user by. Without UserInfo or an ID token, `accountSub` is now absent; `exchangeToken` needs `userInfoEndpoint` to return one.
