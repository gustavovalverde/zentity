# Social Login Integration Guide (Google & GitHub)

This document covers everything needed to ship Google and GitHub social sign-in for Zentity, including the legal and compliance requirements that must be met *before* credentials will work in production.

---

## Design Decisions

### Link-Only (No Sign-Up)

Social sign-in is configured with `disableSignUp: true` on both providers. Users **must** first create a Zentity account via passkey, password (OPAQUE), or wallet signature, then link a social account from Settings. If an unregistered user clicks "Continue with Google/GitHub", they are redirected to `/sign-in?error=signup_disabled` with a toast message directing them to sign up first.

### No Profile Picture Collection

- **Google**: `disableDefaultScope: true` + `scope: ["openid", "email"]` — drops the `profile` scope so Google never sends name or picture in the ID token
- **GitHub**: Default scopes (`read:user`, `user:email`) are kept since `read:user` is required for the `/user` API call, but no avatar URL is mapped to the user record

### Encrypted Token Storage

OAuth access tokens, refresh tokens, and ID tokens are encrypted at rest using XChaCha20-Poly1305 keyed by SHA-256 of `BETTER_AUTH_SECRET`. This is enabled via `account.encryptOAuthTokens: true` in the auth config. Existing plaintext tokens are read as-is and encrypted on the next write cycle.

### Legal Pages

Privacy policy and terms of service are comprehensive markdown files in `docs/legal/`, imported by the landing page via Vite `?raw` and rendered with `MarkdownRenderer`. This provides git-tracked change history for audit purposes.

---

## Current State

### Code: Fully Wired

| Layer | File | Status |
|-------|------|--------|
| Server config | `apps/web/src/lib/auth/auth.ts` | `socialProviders.google` + `.github` with `disableSignUp: true` |
| Token encryption | `apps/web/src/lib/auth/auth.ts` | `account.encryptOAuthTokens: true` |
| Client buttons | `apps/web/src/components/auth/social-login-buttons.tsx` | `errorCallbackURL: "/sign-in"`, `prepareForNewSession()` |
| Sign-in page | `apps/web/src/app/(auth)/sign-in/page.tsx` | Handles `?error=signup_disabled` with toast |
| Env schema | `apps/web/src/env.ts` | All 4 vars defined as `optional()` |
| Privacy Policy | `docs/legal/privacy-policy.md` | Comprehensive, covers Google/GitHub data disclosures |
| Terms of Service | `docs/legal/terms-of-service.md` | Comprehensive, covers alpha status and O'Saasy License |
| Landing pages | `apps/landing/src/pages/legal-pages.tsx` | Renders markdown via `MarkdownRenderer` |

The remaining work is:

1. Provider console setup + domain verification
2. Setting environment variables

---

## Part 1: Google OAuth Setup

### Step 1: Verify Domain Ownership

**This is the most commonly missed step and the #1 rejection reason.**

1. Go to [Google Search Console](https://search.google.com/search-console)
2. Add property `zentity.xyz`
3. Verify via DNS TXT record (recommended) or HTML file upload
4. Ensure the Google account that owns the Cloud Console project has Owner or Editor access in Search Console

### Step 2: Configure OAuth Consent Screen

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials/consent):

| Field | Value |
|-------|-------|
| App name | Zentity |
| User support email | <hello@zentity.xyz> |
| App logo | Your current logo (120x120px, <1MB) |
| Application home page | `https://zentity.xyz` |
| Privacy policy link | `https://zentity.xyz/privacy` |
| Terms of service link | `https://zentity.xyz/terms` |
| Authorized domains | `zentity.xyz` |
| Developer contact email | <hello@zentity.xyz> |

### Step 3: Configure Scopes

Add only:

- `openid`
- `email`

These are **non-sensitive scopes** — no security assessment or demo video required. We intentionally omit `profile` to avoid receiving name/picture.

### Step 4: Create OAuth Client

1. Go to Credentials → Create Credentials → OAuth 2.0 Client ID
2. Application type: Web application
3. Name: `Zentity Web`
4. Authorized JavaScript origins:
   - `http://localhost:3000` (dev)
   - `https://app.zentity.xyz` (prod)
5. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (dev)
   - `https://app.zentity.xyz/api/auth/callback/google` (prod)

### Step 5: Testing Mode vs Production

| Phase | User Limit | What Happens |
|-------|-----------|--------------|
| Testing (default) | 100 explicitly listed test users | "Unverified app" warning, tokens expire in 7 days |
| Production (unverified) | 100 lifetime users (irreversible cap) | "Unverified app" warning to all users |
| Production (verified) | Unlimited | Clean consent screen, no warnings |

**Recommendation:** Stay in Testing mode while developing. Add your own Google account(s) as test users. Only push to Production and submit for brand verification once the privacy policy and terms are final.

### Step 6: Submit for Brand Verification

1. Ensure privacy policy and terms are deployed and publicly accessible
2. Ensure domain is verified in Search Console
3. Click "Verify Branding" in the consent screen settings
4. Expected timeline: **2-3 business days** for non-sensitive scopes

**Important:** If you change the app name, logo, homepage, or privacy policy URL after verification, you must re-verify.

### Common Rejection Reasons

1. Domain not verified in Search Console
2. Privacy policy not linked from homepage (ours IS linked via footer)
3. Privacy policy missing required Google data disclosures
4. Homepage not loading when Google reviews it
5. Privacy policy on a different domain than the homepage

---

## Part 2: GitHub OAuth Setup

GitHub's process is simpler — no formal verification required.

### Step 1: Create OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. OAuth Apps → New OAuth App

| Field | Value |
|-------|-------|
| Application name | Zentity |
| Homepage URL | `https://zentity.xyz` |
| Application description | Privacy-preserving identity verification |
| Authorization callback URL | `https://app.zentity.xyz/api/auth/callback/github` |

**Note:** GitHub OAuth Apps support only ONE callback URL. You need **separate apps** for dev and production:

- **Dev app:** callback URL = `http://localhost:3000/api/auth/callback/github`
- **Prod app:** callback URL = `https://app.zentity.xyz/api/auth/callback/github`

---

## Part 3: Environment Variables

### Local Development (`.env.local`)

```bash
# Google (dev OAuth client)
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx

# GitHub (dev OAuth app)
GITHUB_CLIENT_ID=Ov23liXXXXXXXXXXXXXX
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Production (Railway)

Set in the Railway dashboard for the `web` service:

```bash
GOOGLE_CLIENT_ID=<production client ID>
GOOGLE_CLIENT_SECRET=<production client secret>
GITHUB_CLIENT_ID=<production client ID>
GITHUB_CLIENT_SECRET=<production client secret>
```

Use **separate OAuth apps** for dev and production. Never share credentials between environments.

---

## Part 4: Pre-Launch Checklist

### Legal Pages

- [ ] Deploy updated pages to `zentity.xyz/privacy` and `zentity.xyz/terms`
- [ ] Verify both pages load correctly and are publicly accessible
- [ ] Confirm footer links work on homepage

### Google

- [ ] Verify `zentity.xyz` domain in Google Search Console
- [ ] Configure OAuth consent screen with correct URLs
- [ ] Request only `openid` and `email` scopes (no `profile`)
- [ ] Create dev OAuth client (localhost callback)
- [ ] Create production OAuth client (app.zentity.xyz callback)
- [ ] Add test users in Testing mode
- [ ] Test full sign-in flow locally — verify existing account linking works
- [ ] Test sign-in with unregistered email — verify "No account found" toast appears
- [ ] Push to Production and submit for brand verification
- [ ] Wait for verification approval (~2-3 business days)

### GitHub

- [ ] Create dev OAuth app (localhost callback)
- [ ] Create production OAuth app (app.zentity.xyz callback)
- [ ] Test full sign-in flow locally

### Environment

- [ ] Set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `.env.local`
- [ ] Set `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` in `.env.local`
- [ ] Set all 4 vars in Railway for production
- [ ] Verify `NEXT_PUBLIC_APP_URL` is correct in production (`https://app.zentity.xyz`)

### Testing

- [ ] Google sign-in with existing account links successfully and redirects to `/dashboard`
- [ ] GitHub sign-in with existing account links successfully and redirects to `/dashboard`
- [ ] Google sign-in with unregistered email redirects to `/sign-in?error=signup_disabled`
- [ ] Sign-in page shows "No account found" toast for `signup_disabled` error
- [ ] Sign-in page shows correct "last used" label after social login
- [ ] Social sign-in works on production domain after deploying credentials

---

## Appendix: Callback URL Reference

| Provider | Environment | Callback URL |
|----------|-------------|-------------|
| Google | Dev | `http://localhost:3000/api/auth/callback/google` |
| Google | Production | `https://app.zentity.xyz/api/auth/callback/google` |
| GitHub | Dev | `http://localhost:3000/api/auth/callback/github` |
| GitHub | Production | `https://app.zentity.xyz/api/auth/callback/github` |

These are the default better-auth callback paths. They are derived from `NEXT_PUBLIC_APP_URL` + `/api/auth/callback/{provider}`.
