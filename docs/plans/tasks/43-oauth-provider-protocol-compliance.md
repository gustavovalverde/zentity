# Task 43: OAuth Provider Protocol Compliance

> Phase 5 of [Cross-App Auth Hardening](../cross-app-auth-hardening.md)
> Findings: #8 (PAR hook race), #9 (post-logout redirect bypass)

## Status: Not started

## Problem

Two protocol compliance bugs in the web app's OAuth provider layer:

### PAR hook race (#8)

`afterParPersistResource` runs after the PAR endpoint creates a new `haipPushedRequests` row. The hook needs to store the `resource` parameter on that row, but it doesn't know which row was just created. It queries by `clientId ORDER BY createdAt DESC LIMIT 1` — which returns the **newest** row for the client, not necessarily the one from this request.

If the same RP sends two PAR requests close together, whichever hook runs last can update the wrong row, and the later authorize/token exchange mints an access token for the wrong `resource` (audience).

### Post-logout redirect bypass (#9)

The end-session endpoint only validates `post_logout_redirect_uri` when `client_id` is present in the query string. Per OIDC RP-Initiated Logout 1.0, `client_id` is optional when `id_token_hint` is provided (the RP can be inferred from the token). When `client_id` is absent, any caller with a valid `id_token_hint` can redirect to an arbitrary URL.

## Solution

### PAR hook correlation

**Preferred approach**: Pass the generated `requestId` through the hook context.

The PAR handler (inside the HAIP plugin) generates a `requestId` when creating the `haipPushedRequests` row. If the after-hook context includes this `requestId`, `afterParPersistResource` can update the exact row:

```sql
UPDATE haip_pushed_request SET resource = ? WHERE request_id = ?
```

If the HAIP plugin doesn't expose `requestId` in the hook context, two fallback approaches:

1. **Patch the HAIP plugin** to attach `requestId` to the context (similar to the existing oauth-provider patch)
2. **Filter by unset resource**: Query `WHERE clientId = ? AND resource IS NULL ORDER BY createdAt DESC LIMIT 1`. This narrows the race window significantly — only rows that haven't been resource-stamped yet are candidates.

The fallback still has a theoretical race if two requests both have `resource IS NULL` simultaneously, but it's a massive improvement over the current "newest row" approach.

### End-session redirect validation

When `post_logout_redirect_uri` is present but `client_id` is absent:

1. The `id_token_hint` has already been verified at this point in the handler
2. Extract the effective client ID: `payload.azp` (authorized party) or `payload.aud` (audience — may be a string or array, take the first element if array)
3. Use this inferred client ID to look up the client's registered `postLogoutRedirectUris`
4. Validate the `post_logout_redirect_uri` against them (same logic as the existing `clientId` path)

Edge cases:

- If `aud` is an array with multiple values and no `azp`, this is an ambiguous case. Reject the redirect to be safe (return the logout success page without redirect).
- If the inferred client has no registered `postLogoutRedirectUris`, skip redirect (same as current behavior when client has no URIs).

## Acceptance criteria

- [ ] `afterParPersistResource` updates the row matching the current request's `requestId` (or `resource IS NULL` fallback)
- [ ] Concurrent PAR requests from the same client update their own rows
- [ ] End-session validates `post_logout_redirect_uri` against `azp`/`aud` from `id_token_hint` when `client_id` is absent
- [ ] End-session rejects unregistered `post_logout_redirect_uri` even without `client_id`
- [ ] End-session allows registered `post_logout_redirect_uri` when inferred client matches
- [ ] Ambiguous `aud` (array with no `azp`) does not redirect
- [ ] Test: two PAR requests in flight update their own resource fields
- [ ] Test: `GET /end-session?id_token_hint=...&post_logout_redirect_uri=https://evil.com` returns 400 when URI not registered for the azp client
- [ ] Test: valid redirect URI for the azp client succeeds without `client_id`

## Notes

- The PAR hook fix may require a vendor patch if the HAIP plugin doesn't expose `requestId` in the after-hook context. Check `vendor/better-auth-haip-*.tgz` to see what the hook context includes.
- For the end-session fix, the `azp` claim is the most reliable indicator of the intended RP since it's always a single client ID. `aud` can be an array (e.g., when the token was issued to one client but audiences include an API resource).
- Both fixes are in the web app's OAuth provider layer but touch different modules (auth.ts hooks vs. end-session route handler).
