# Better Auth Gap Analysis — Zentity (Explicit Mapping + Plugin Opportunities)

> Goal: identify **where Zentity uses Better Auth**, **where gaps remain**, and **what the codebase does** across authentication, onboarding, and Web3 session boundaries.

## How to Read This Document

Each gap follows the same format:

- **Why this matters (architecture/UX)**
- **Zentity code locations** (where the gap lives)
- **Better Auth capability** (code paths + endpoints/plugins)
- **Current state** (what the code does)
- **Dependencies / notes**

---

## G1) Custom Passkey Auth Stack (Server)

**Why this matters (architecture/UX)**

- Passkeys are the **key‑custody anchor** (vault + FHE keys), not just login.
- Custom WebAuthn verification + manual cookie signing can drift from Better Auth session behavior.

**Zentity locations**

- `apps/web/src/lib/auth/auth.ts` (passkey plugin configuration + pre-auth hooks)
- `apps/web/src/app/api/auth/[...all]/route.ts` (Better Auth Next.js handler)
- `apps/web/src/lib/auth/auth-client.ts` (passkey client plugin)

**Better Auth capability**

- Passkey plugin + endpoints:
  - `better-auth/packages/passkey/src/index.ts`
  - `better-auth/packages/passkey/src/routes.ts` (`/passkey/*` endpoints)
  - `better-auth/packages/passkey/src/types.ts` (pre‑auth `resolveUser`, `afterVerification`, `extensions`)

**Current state**

- Passkey registration/authentication uses Better Auth passkey endpoints.
- Pre‑auth registration uses `resolveUser` + `afterVerification` to bind onboarding context to the final user.

**Dependencies / notes**

- Passkey flows use the Better Auth `passkey` schema (see G2).
- Client flows use `authClient.passkey.*` (see G5).

---

## G2) Passkey Data Model Drift

**Why this matters (architecture/UX)**

- Better Auth expects a `passkey` schema; Zentity uses a custom table. This blocks built‑in passkey management APIs.

**Zentity locations**

- `apps/web/src/lib/db/schema/auth.ts` → `passkey` table

**Better Auth capability**

- Passkey schema definition:
  - `better-auth/packages/passkey/src/schema.ts`
- Reference schemas (sqlite):
  - `better-auth/packages/cli/test/__snapshots__/auth-schema-sqlite-passkey.txt`

**Current state**

- The `passkey` table matches Better Auth schema.
- Passkey management uses Better Auth APIs via `authClient.passkey.*`.

**Dependencies / notes**

- ER diagrams reference the Better Auth `passkey` table.

---

## G3) Manual Session Cookies + Custom Challenge Storage

**Why this matters (architecture/UX)**

- Session cookies + challenge verification are security‑critical; manual logic is fragile.

**Zentity locations**

- `apps/web/src/app/api/auth/[...all]/route.ts` (Better Auth sets cookies)

**Better Auth capability**

- Challenge storage + session cookie creation:
  - `better-auth/packages/passkey/src/routes.ts`
  - `better-auth/packages/better-auth/src/cookies`

**Current state**

- Challenge storage and session cookies are handled by Better Auth.

---

## G4) Pre‑Auth Registration Tokens Stored In‑Memory

**Why this matters (architecture/UX)**

- In‑memory tokens break multi‑instance environments.

**Zentity locations**

- `apps/web/src/lib/auth/onboarding-context.ts` (context + registration tokens)
- `apps/web/src/lib/db/schema/auth.ts` (`verification` table)

**Better Auth capability**

- Internal verification storage (used across Better Auth endpoints)
- One‑time token plugin:
  - `better-auth/packages/better-auth/src/plugins/one-time-token`

**Current state**

- Onboarding context + registration tokens are stored in the `verification` table with TTL enforcement.

---

## G5) Passkey UX Uses Custom Client Flows

**Why this matters (architecture/UX)**

- Bypasses Better Auth client helpers (extensions merging, error handling, session signals).

**Zentity locations**

- `apps/web/src/components/onboarding/steps/step-create-account.tsx`
- `apps/web/src/components/auth/passkey-sign-in-form.tsx`
- `apps/web/src/components/dashboard/passkey-management-section.tsx`
- `apps/web/src/app/(auth)/recover-passkey/page.tsx`

**Better Auth capability**

- Passkey client plugin:
  - `better-auth/packages/passkey/src/client.ts`

**Current state**

- `passkeyClient()` is enabled in `auth-client.ts`.
- Passkey UX paths use Better Auth client APIs.
- `returnWebAuthnResponse` is used when PRF output is required.

---

## G6) Manual User Creation / Deletion Outside Better Auth

**Why this matters (architecture/UX)**

- Bypasses Better Auth lifecycle hooks and plugins.

**Zentity locations**

- `apps/web/src/lib/auth/auth.ts` (passkey verification creates user/session)
- `apps/web/src/lib/trpc/routers/account.ts` (uses `auth.api.deleteUser`)

**Better Auth capability**

- User deletion API:
  - `better-auth/packages/better-auth/src/api/routes/update-user.ts` (`deleteUser`)

**Current state**

- Passkey verification creates user + session.
- Account deletion uses the Better Auth delete API.

---

## G7) Custom RP Redirect Flow vs OAuth Provider

**Why this matters (architecture/UX)**

- Standards‑based OAuth reduces integration friction and avoids custom redirect handling.

**Zentity locations**

- `apps/web/src/lib/auth/auth.ts` (OAuth provider plugin)
- `apps/web/src/lib/db/schema/oauth-provider.ts` (oauth tables)
- `docs/rp-redirect-flow.md` (OAuth provider flow)

**Better Auth capability**

- OAuth 2.1 Provider plugin:
  - `better-auth/packages/oauth-provider`
  - Docs: `https://www.better-auth.com/docs/plugins/oauth-provider`

**Current state**

- RP routes are not part of the API surface.
- OAuth 2.1 Provider plugin is enabled with standard metadata + token exchange.

**Dependencies / notes**

- OAuth provider plugin is noted as “active development” in docs.

---

## G8) Privacy‑Preserving Onboarding (Anonymous Users)

**Why this matters (architecture/UX)**

- Zentity’s privacy goals suggest users should start onboarding **without providing PII** (email).

**Zentity locations**

- `apps/web/src/lib/auth/auth.ts` (anonymous plugin + `isAnonymous`)
- `apps/web/src/components/onboarding/steps/step-create-account.tsx` (starts anonymous session)
- `apps/web/src/components/onboarding/steps/step-email.tsx` (email is optional)

**Better Auth capability**

- Anonymous plugin:
  - `better-auth/packages/better-auth/src/plugins/anonymous`
  - Docs: `https://www.better-auth.com/docs/plugins/anonymous`
  - Adds `isAnonymous` field to user schema; supports linking later.

**Current state**

- Anonymous sessions are enabled; onboarding can proceed without email.
- Email is optional and can be linked later.

**Dependencies / notes**

- User schema includes `isAnonymous`.

---

## G9) Web3 Wallet Auth Alignment (SIWE)

**Why this matters (architecture/UX)**

- Wallet connection ≠ authenticated session. SIWE provides a privacy‑preserving bridge between Web3 wallets and Better Auth sessions.

**Zentity locations**

- Wallet + Web3 UX: `apps/web/src/components/providers/web3-provider.tsx`
- SIWE bridge + helper: `apps/web/src/components/providers/siwe-bridge.tsx`, `apps/web/src/lib/auth/siwe.ts`
- On‑chain attestation UI: `apps/web/src/components/dashboard/on-chain-attestation.tsx`
- API routes: `apps/web/src/app/api/fhe/*`

**Better Auth capability**

- SIWE plugin:
  - `better-auth/packages/better-auth/src/plugins/siwe`
  - Docs: `https://www.better-auth.com/docs/plugins/siwe`
  - Provides nonce + verify flows; supports anonymous sign‑in option.

**Current state**

- SIWE creates a Better Auth session tied to the wallet address.
- Web3/FHE session gating is documented in G13.

---

## G10) External Identity / ZK Partner Integration (Generic OAuth)

**Why this matters (architecture/UX)**

- Zentity may need to integrate external identity providers or proof partners in a standardized way.

**Zentity locations**

- `apps/web/src/lib/auth/auth.ts` (generic OAuth plugin + config parser)
- `apps/web/src/lib/auth/auth-client.ts` (generic OAuth client plugin)
- `docs/oauth-integrations.md` (usage examples)

**Better Auth capability**

- Generic OAuth plugin:
  - `better-auth/packages/better-auth/src/plugins/generic-oauth`
  - Docs: `https://www.better-auth.com/docs/plugins/generic-oauth`
  - Supports OAuth 2.0 + OIDC, custom providers.

**Current state**

- Generic OAuth providers are configured via `GENERIC_OAUTH_PROVIDERS`.
- `mapProfileToUser` maps provider profile data into Better Auth user fields.

---

## G11) Last Login Method UX (Smooth Sign‑In)

**Why this matters (architecture/UX)**

- Improves login UX by surfacing “last used method” (passkey, magic link, SIWE, etc.).

**Zentity locations**

- `apps/web/src/app/(auth)/sign-in/page.tsx`
- `apps/web/src/components/auth/*`

**Better Auth capability**

- Last login method plugin:
  - `better-auth/packages/better-auth/src/plugins/last-login-method`
  - Docs: `https://www.better-auth.com/docs/plugins/last-login-method`

**Current state**

- Server + client plugin enabled.
- Sign‑in UI reads the last‑used method cookie, sets the default tab, and shows the last used method label (`apps/web/src/app/(auth)/sign-in/page.tsx`).

---

## G12) Onboarding Wizard Session Mechanism (Optional Drift)

**Why this matters (architecture/UX)**

- Wizard state is custom and separate from Better Auth; not wrong, but inconsistent.

**Zentity locations**

- `apps/web/src/lib/db/onboarding-session.ts`

**Better Auth capability**

- Internal verification storage
- Custom session plugin:
  - `better-auth/packages/better-auth/src/plugins/custom-session`

**Current state**

- Wizard state uses custom onboarding session storage (encrypted cookie + DB).
- Better Auth custom session plugin is not used.
- Status: under evaluation (see G12 analysis in current workstream).

---

## G13) Web3 Consent + Passkey Unlock Enforcement

**Why this matters (architecture/UX)**

- Web3 actions should require both:
  - Better Auth session (auth)
  - Passkey PRF unlock (explicit consent for encrypted data)

**Zentity locations**

- Web3 endpoints: `apps/web/src/app/api/fhe/*`
- Passkey unlock: `apps/web/src/components/providers/passkey-auth-provider.tsx`

**Better Auth capability**

- Session enforcement via `auth.api.getSession`.
- Passkey unlock is client‑side (outside Better Auth).

**Current state (audit complete)**

- ✅ All Web3/FHE server entry points require a Better Auth session.
  - `apps/web/src/app/api/fhe/verify-age/route.ts` (requires session)
  - `apps/web/src/app/api/fhe/enrollment/complete/route.ts` (requires session)
  - `apps/web/src/app/api/fhe/keys/register/route.ts` (requires session unless
    using a registration token)
  - `apps/web/src/app/api/identity/disclosure/route.ts` (requires session)
  - `apps/web/src/lib/trpc/routers/attestation.ts` (protected procedure)
- ✅ Encrypted operations require explicit PRF unlock on the client.
  - FHE verification uses `verifyAgeViaFHE` → `decryptFheBool` →
    `getStoredFheKeys` → `evaluatePrf` (user gesture required).
  - On-chain attestation and disclosure flows call `getStoredProfile` to unlock
    encrypted profile data before use.
- ✅ Auto-unlock is suppressed unless a cached passkey unlock exists to avoid
  background prompts on shared devices.

---

## 14) Documentation Alignment Tasks (Post‑Closure)

- ✅ ER diagrams updated for the Better Auth `passkey` schema.
- ✅ Onboarding flow docs updated for Better Auth passkey endpoints + pre‑auth context.
- ✅ Web3 docs updated to mention Better Auth session gating + passkey unlock.

---

## 15) Suggested Execution Order

1) **G1 + G5**: Replace passkey server/client flows with Better Auth.
2) **G2**: Migrate passkey schema.
3) **G3 + G4**: Remove manual cookies + in‑memory tokens.
4) **G8 + G9**: Introduce anonymous onboarding + SIWE for wallet sessions.
5) **G11**: Add last‑login‑method UI improvements.
6) **G7 + G10**: OAuth provider and generic OAuth integrations.
7) **G12 + G13**: Optional alignment for wizard sessions and Web3 consent gating.

---

If you want, I can append exact endpoint payloads and code‑change lists for each gap.

---

## Appendix A) File‑by‑File Change List (Per Plugin)

> This appendix is strictly about **where** changes happen in Zentity and **what** to add/remove to adopt the Better Auth plugins listed in G8–G11.

### A1) Anonymous Plugin (privacy‑preserving onboarding)

**Better Auth code**

- Server plugin: `better-auth/packages/better-auth/src/plugins/anonymous/index.ts`
- Client plugin: `better-auth/packages/better-auth/src/plugins/anonymous/client.ts`

**Zentity changes**

1. `apps/web/src/lib/auth/auth.ts`
   - Import `anonymous` from `better-auth/plugins`.
   - Add to `plugins: [ ... ]` with config (optional):
     - `emailDomainName` (e.g. `anon.zentity.app`)
     - `generateRandomEmail` (optional)
     - `onLinkAccount` (optional; transfer onboarding data when user links a real identity)
2. `apps/web/src/lib/auth/auth-client.ts`
   - Import `anonymousClient` from `better-auth/client/plugins`.
   - Add to `plugins: [ ... ]` so `authClient.signIn.anonymous()` becomes available.
3. `apps/web/src/components/onboarding/steps/step-create-account.tsx`
   - Start onboarding with `authClient.signIn.anonymous()` before asking for email.
   - Defer email collection until user chooses to link.
4. `apps/web/src/components/auth/*`
   - Add a “Continue without email” CTA for privacy‑first onboarding.

---

### A2) SIWE Plugin (Web3 wallet → Better Auth session)

**Better Auth code**

- Server plugin: `better-auth/packages/better-auth/src/plugins/siwe/index.ts`
- Client plugin: `better-auth/packages/better-auth/src/plugins/siwe/client.ts`

**Zentity changes**

1. `apps/web/src/lib/auth/auth.ts`
   - Import `siwe` from `better-auth/plugins`.
   - Configure:
     - `domain` (env‑based)
     - `getNonce` (generate secure nonce)
     - `verifyMessage` (SIWE signature verification)
     - `anonymous: true` (if you want wallet‑only onboarding)
2. `apps/web/src/lib/auth/auth-client.ts`
   - Import `siweClient` from `better-auth/client/plugins`.
   - Add to `plugins: [ ... ]`.
3. `apps/web/src/components/providers/web3-provider.tsx`
   - Add SIWE flow:
     - call `/siwe/nonce` (via authClient fetch)
     - sign SIWE message
     - POST `/siwe/verify`
4. `apps/web/src/app/api/fhe/*`
   - Ensure all Web3 routes require Better Auth session.

---

### A3) Generic OAuth Plugin (external identity / ZK partner integration)

**Better Auth code**

- Server plugin: `better-auth/packages/better-auth/src/plugins/generic-oauth/index.ts`
- Client plugin: `better-auth/packages/better-auth/src/plugins/generic-oauth/client.ts`

**Zentity changes**

1. `apps/web/src/lib/auth/auth.ts`
   - Import `genericOAuth` from `better-auth/plugins`.
   - Add provider config (for any external identity/ZK partner):
     - `providerId`, `authorizationUrl`, `tokenUrl`, `clientId`, `clientSecret`, `scopes`, `redirectURI`, `mapProfileToUser`.
2. `apps/web/src/lib/auth/auth-client.ts`
   - Import `genericOAuthClient` from `better-auth/client/plugins`.
   - Add to plugins list.
3. `apps/web/src/components/auth/oauth-buttons.tsx`
   - Add new OAuth buttons that call `authClient.signIn.oauth2({ providerId })`.

---

### A4) OAuth Provider Plugin (replace RP flow)

**Better Auth code**

- Server plugin: `better-auth/packages/oauth-provider/src/oauth.ts` (exported as `oauthProvider`)
- Entry: `better-auth/packages/oauth-provider/src/index.ts`

**Zentity changes**

1. `apps/web/src/lib/auth/auth.ts`
   - Import `oauthProvider` from `@better-auth/oauth-provider`.
   - Add to `plugins: [ ... ]` with server config (issuer, scopes, clients, etc.).
2. Replace/remove:
   - `apps/web/src/app/api/rp/[...path]/route.ts`
   - `apps/web/src/lib/auth/rp-flow.ts`
3. Update RP docs:
   - `docs/rp-redirect-flow.md` → replace with OAuth/OIDC flows.

---

### A5) Last Login Method Plugin (UX improvement)

**Better Auth code**

- Server plugin: `better-auth/packages/better-auth/src/plugins/last-login-method/index.ts`
- Client plugin: `better-auth/packages/better-auth/src/plugins/last-login-method/client.ts`

**Zentity changes**

1. `apps/web/src/lib/auth/auth.ts`
   - Import `lastLoginMethod` from `better-auth/plugins`.
   - Add to plugins list. Optionally `storeInDatabase: true`.
2. `apps/web/src/lib/auth/auth-client.ts`
   - Import `lastLoginMethodClient` from `better-auth/client/plugins`.
   - Add to plugins list.
3. `apps/web/src/app/(auth)/sign-in/page.tsx`
   - Use `authClient.lastLoginMethod.getLastUsedLoginMethod()` to preselect the correct tab.

---

## Appendix B) Payload / Endpoint Mapping (Per Plugin)

### B1) Anonymous Plugin

**Endpoint**: `POST /sign-in/anonymous`

- **Request**: empty body
- **Response**:
  - `{ token, user: { id, email, emailVerified, name, createdAt, updatedAt } }`

### B2) SIWE Plugin

**Endpoint**: `POST /siwe/nonce`

- **Request**: `{ walletAddress: "0x…", chainId?: number }`
- **Response**: `{ nonce }`

**Endpoint**: `POST /siwe/verify`

- **Request**:
  - `{ message, signature, walletAddress, chainId?, email? }`
- **Response**:
  - `{ token, success: true, user: { id, walletAddress, chainId } }`

### B3) Generic OAuth Plugin

**Endpoint**: `POST /sign-in/oauth2`

- **Request**:
  - `{ providerId, callbackURL?, errorCallbackURL?, newUserCallbackURL?, disableRedirect?, scopes?, requestSignUp?, additionalData? }`
- **Response**:
  - `{ url, redirect }` (authorization URL for provider)

**Callback**: `GET /oauth2/callback/:providerId` (handled by Better Auth)

### B4) OAuth Provider Plugin (Server)

**Key endpoints** (all handled by Better Auth):

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/openid-configuration` (if OpenID scope enabled)
- `GET /oauth2/authorize`
- `POST /oauth2/consent`
- `POST /oauth2/continue`
- `POST /oauth2/token`
- `POST /oauth2/introspect`
- `POST /oauth2/revoke`
- `GET /oauth2/userinfo`
- `GET /oauth2/end-session`
- `POST /oauth2/register` (if dynamic client registration enabled)

### B5) Last Login Method Plugin

- **No endpoints**. Cookie name defaults to:
  - `better-auth.last_used_login_method`
- **Client actions**:
  - `authClient.lastLoginMethod.getLastUsedLoginMethod()`
  - `authClient.lastLoginMethod.clearLastUsedLoginMethod()`
  - `authClient.lastLoginMethod.isLastUsedLoginMethod(method)`
