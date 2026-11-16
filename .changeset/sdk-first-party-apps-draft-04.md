---
"@zentity/sdk": minor
---

`@zentity/sdk/fpa` now speaks the draft-ietf-oauth-first-party-apps-04 wire that Zentity's Authorization Challenge Endpoint serves through the `@better-auth/first-party-apps` plugin. It needs a Zentity server from the same release, and an older server rejects its requests.

- The initial challenge request is form-encoded and sends the identifier as `login_hint`. Challenges arrive as HTTP 403 `insufficient_authorization`.
- `authenticate` and `stepUp` no longer take `redirectUri`, and challenge codes are redeemed without `redirect_uri`. `exchangeAuthorizationCode` takes `redirectUri` only for a code from a browser flow.
- `TokenResult` gains `authSession`, the handle the token response returns. `AuthenticationResult.authSession` and the stored `authSession` now come from it, because it replaces the handle the challenge rounds used.
- `RedirectToWebError` takes an options object, and its `authSession` is optional. It also carries `acrValues` and `maxAge` for a browser sign-in at a higher assurance level.
- A sign-in whose code waits for a higher assurance tier throws `StepUpRequiredError` with the `auth_session` to present again.
