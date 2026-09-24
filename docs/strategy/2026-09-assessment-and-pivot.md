# Zentity: status, product-market fit, and pivot options (September 2026)

Prepared for the Web Summit application and to decide what the product becomes next.
The repository numbers come from checks run on 2026-09-24. The market statements are my
reading of the space. Check them against current sources and customer conversations before
you rely on them.

---

## 1. Where the project stands

### Activity
- Last commit: **2026-06-19**, a better-auth `1.7.0-beta.9` upgrade. There have been no commits for about three months.
- The repo contains 7 apps (web, fhe, ocr, signer, mcp, demo-rp, landing), 1 SDK and 27 RFCs.
- The README still says **"Pre-Audit Beta — not production-ready"**. No independent audit has been done.

### Security posture (`pnpm audit --prod`)
**137 advisories: 3 critical, 49 high, 72 moderate, 13 low.** Most come from a few root dependencies:

| Priority | Root dependency | Issue | Fix |
|---|---|---|---|
| P0 | `next` 16.2.x (web, demo-rp, landing) | Unauthenticated RCE in image optimization (critical), middleware bypass, SSRF in Server Actions | Bump to `>=16.3.3` |
| P0 | `better-auth` 1.7.0-beta.9 plus 5 vendored plugin tarballs (ciba, haip, oidc4ida, oidc4vci, oidc4vp) | Account takeover via pre-account hijacking on magic link | Bump to `>=1.7.0-beta.10` (or stable 1.7.x) and **rebuild the vendored tarballs** |
| P0 | `@simplewebauthn/server` (via `@better-auth/passkey`) | Attestation chain not checked against a trust anchor | `>=13.3.2` |
| P1 | `@tensorflow/tfjs-node` → `tar`, `adm-zip`, `brace-expansion` | Critical tar DoS plus zip memory bombs | Override transitive versions, or drop tfjs-node for a maintained face runtime |
| P1 | OpenTelemetry → `@grpc/grpc-js`, `protobufjs` | Server crash and DoS | Bump the OTel packages |
| P2 | demo-rp wallet stack (wagmi → hono, axios, form-data) | CORS reflection, CRLF injection | Bump wagmi/porto |
| P2 | landing (`react-router`, `fumadocs`/`js-yaml`, `shadcn` CLI → `fast-uri`) | DoS, CSRF bypass, SSRF | Bump, and move `shadcn` to devDependencies |

Rust services: TFHE-rs `~1.4`, FROST `2.2.0`, axum 0.8 and actix 4.13 all need a `cargo update` and a `cargo audit` pass. That tool isn't installed here, so I haven't run it.

### Structural debt
- **Vendored beta auth plugins.** CIBA, HAIP and OID4VCI/VP are pinned to `.tgz` builds of an auth library that is still in beta. Every upstream security fix means rebuilding those tarballs by hand. This is the biggest recurring maintenance cost.
- **ZK toolchain on betas.** `@noir-lang/noir_js 1.0.0-beta.19` and `@aztec/bb.js 4.0.4` need a version bump, a circuit recompile, and `circuits:check-versions` to pass.
- **Scope.** The product covers KYC, FHE, ZK, on-chain attestation (fhEVM, Base), FROST recovery, OID4VCI/VP, HAIP, CIBA agents, MCP, Zcash aid and World ID. That is too much surface for a small team to secure, maintain, or explain to a buyer.

### Two-week "get current" plan (before any demo)
1. Bump Next, better-auth, the vendored plugins and SimpleWebAuthn. Run `pnpm check-all` and the integration suites.
2. Add `pnpm.overrides` for the transitive tar, adm-zip, brace-expansion, nanoid, undici, ws and fast-uri issues. Target: 0 critical and 0 high.
3. Run `cargo update` and `cargo audit` on `apps/fhe` and `apps/signer`, then rebuild the images.
4. Enable Dependabot or Renovate, and add a `pnpm audit --audit-level=high` gate to `test.yml`.
5. Redeploy `app.zentity.xyz` and the demo-rp, then smoke-test the Aether (CIBA) and VeriPass (OID4VP) demos. These are what judges will click.
6. Freeze and archive features you won't pitch (Zcash aid, the fhEVM compliant token, the Base mirror, and World ID if it's unused) behind flags or in an `archive/` branch.

---

## 2. Business description (Web Summit draft)

**One-liner:** Zentity lets apps and AI agents prove who is allowed to act, without collecting the identity data behind it.

**Short description (about 50 words):**
Zentity is a privacy-preserving verification layer. Users verify once with a passport chip or document plus liveness. Relying parties and AI agents then receive cryptographic proofs such as "over 18", "EU resident", "sanctions-clear" or "a verified human approved this purchase", over standard OAuth/OpenID. No passport copies are stored and no personal-data breach risk accrues.

**Problem:** Companies are legally required to check age, identity and eligibility, but storing that evidence creates breach liability, GDPR exposure and user drop-off. AI agents now transact on users' behalf, and there's no standard way to prove that a real, verified person authorised an action.

**Solution:** Zero-knowledge proofs are generated on the user's device. Encrypted attributes are stored under keys the user controls (passkey, password or wallet). Standards-based delivery covers OIDC, OID4VP (EU Digital Identity Wallet compatible) and CIBA for agent approvals. It integrates like "Sign in with…".

**Differentiation:** Incumbent KYC vendors store documents. Zentity stores only proofs and ciphertexts, and it natively supports human approval of agent actions (MCP plus CIBA plus agent attestation).

**Stage:** Working beta with a live demo, open source, pre-revenue, and security audit pending. *(Edit this to match reality: team size, location, pilots, funding.)*

**Industry tags:** Identity and security, AI, RegTech, Privacy.

---

## 3. Why product-market fit has been hard

1. **The buyer is unclear.** "Privacy-preserving KYC" is aimed at banks and exchanges. Those buyers buy on certification, liability transfer, coverage and price, not on cryptography. They also can't use a pre-audit, uncertified vendor. That's a very long sales cycle for a small team.
2. **Privacy is a feature, not the pain.** Few buyers switch KYC providers for privacy alone. The switch happens when privacy removes a cost: breach liability, data retention, a regulator saying "don't store IDs", or user drop-off.
3. **It's hard to explain.** FHE, ZK, FROST and on-chain attestation all appear in the pitch. Buyers hear complexity and risk.
4. **The two-sided cold start.** Reusable identity needs users who have already verified *and* relying parties that accept the proof. Neither side comes first on its own.
5. **Too broad.** Many half-productised use cases split the effort, so none reaches "a customer can go live next week".

---

## 4. Pivot options (built on what already exists)

| Option | What you sell | Why now | Reuse | Risk |
|---|---|---|---|---|
| **A. Agent authorization ("human-in-the-loop for AI agents")** | An API/SDK so an agent platform or merchant can get a verified human's approval (with limits and step-up) before an agent pays, signs or reads PII | Agentic commerce and MCP adoption; merchants and payment networks need proof of *who* authorised an agent | High: CIBA, agent host/session attestation, capability grants, MCP server, Aether demo | Crowded by big players (identity incumbents, payment networks). You need a sharp niche. |
| **B. Privacy-first age assurance** | "Over-18/16/13" checks for platforms facing age-verification laws (UK OSA, EU DSA guidelines, Australia under-16, US states) with no ID retention | Regulation forces demand. Platforms actively *don't want* to hold IDs. Clear budget holder (trust and safety). | High: age circuit, NFC chip path, liveness, OIDC | Price competition, and certification (for example PAS 1296 or ACCS audits) is expected |
| **C. EUDI Wallet relying-party toolkit** | Drop-in verifier so businesses accept EU Digital Identity Wallet credentials (OID4VP/HAIP) and get only the minimal claim | eIDAS 2.0: member-state wallets are rolling out and regulated sectors must accept them | High: OID4VP, HAIP, DCQL, JARM, VeriPass | Standards still moving, and many free/open verifiers are appearing |
| D. Stay a general KYC provider | – | – | – | Not recommended: certification plus sales cycle, against well-funded incumbents |

### Recommendation
Lead with **B (age assurance)** as the revenue wedge, with **C** as its distribution path, and pitch **A** as the vision:

> "Zentity is the proof layer for the age-gated and agentic internet. Today it answers
> 'is this user old enough?' without storing an ID, whether the proof comes from a passport chip or an
> EU wallet. Tomorrow it proves a verified human authorised what their AI agent did."

Why: B has a regulatory deadline, a budget owner and a single claim that's easy to explain. C removes the cold start, because users bring a wallet the government issued. A is the most exciting story for Web Summit judges and investors, and the code already demos it.

### What to cut or hide from the pitch
FHE jargon, fhEVM tokens, Zcash aid, FROST details. Keep them as "defence in depth" in technical docs only.

---

## 5. Validating PMF in 6–8 weeks

1. **20 discovery calls** per candidate segment (trust-and-safety leads at dating, gaming, adult and social platforms for B; agent-commerce startups for A). Ask what they use today, what it costs, and what worries them about storing IDs. Don't pitch.
2. **Landing-page test:** one page per option, each with a "Get API key" or waitlist call to action. Measure sign-ups.
3. **Success bar:** 3 or more design partners with a signed LOI or a paid pilot in a single segment. Commit to that segment and archive the rest.
4. **Credibility items buyers will ask for:** a third-party security audit (start with the auth and ZK circuits), a DPIA template, a certification plan for age assurance, uptime/SLA and pricing (per verification).

## 6. Repository changes that follow from the pivot
- Rewrite the README hero and landing copy around the chosen wedge. Remove the "three audiences" breadth.
- Publish a minimal SDK quickstart ("age check in 10 lines") in `packages/sdk`.
- Put non-core apps and features behind flags, and document the cuts in an ADR.
- Keep the `pnpm audit` gate and Renovate so the repo doesn't drift again.
