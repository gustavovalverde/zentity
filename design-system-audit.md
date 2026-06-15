# Design System Audit — Zentity

**Scope:** `apps/web` (Next.js 16) and `apps/landing` (React Router 7 / Vite)
**Focus:** Design tokens & color, spacing & layout, typography, component variants & states
**Date:** 2026-06-13

---

## Summary

**Design system health: 58 / 100** — *Two solid systems that don't match each other.*

The headline finding is not sloppiness inside either app — it's that **`apps/web` and `apps/landing` are two independent design systems** that were both scaffolded from shadcn/ui but with different presets, palettes, fonts, icon libraries, and component copies. There is **no shared UI or token package** (the only shared package is `@zentity/sdk`, which is non-visual). Every shared component — Button, Badge, Tabs, Item — exists twice and has drifted.

Internally, `apps/web` is disciplined (0 raw palette colors, 0 ad-hoc buttons, semantic tokens in real use). `apps/landing` is structurally clean but **bypasses its own semantic color tokens** in favor of 58 hardcoded Tailwind palette colors, and uses 20 off-scale font sizes.

| Area | Score | One-line verdict |
|------|:-----:|------------------|
| Cross-app foundation alignment | 3/10 | Different brand palette, fonts, radius, icons, preset |
| Token coverage (no hardcoded values) | 7/10 | web ~9/10, landing ~5/10 (58 raw colors) |
| Naming consistency | 5/10 | `success/info` vs `text-error/icon-*`; `cn` vs `utils` |
| Component single-source & completeness | 4/10 | 4 components duplicated & drifted, no shared package |
| Typography consistency | 6/10 | Opposite weight conventions; off-scale sizes in landing |

**Components reviewed:** 40 (31 web ui/, 9 landing ui/) · **Distinct issues:** 11 · **Files touched by issues:** ~35

---

## What the design system actually *is* today

Both apps use Tailwind v4 (CSS-first `@theme`), shadcn/ui, `class-variance-authority`, `tailwind-merge`, and CSS-variable tokens with light/dark. That's the shared DNA. Everything below it diverges:

| Foundation | `apps/web` | `apps/landing` | Impact |
|-----------|-----------|----------------|--------|
| Framework / rendering | Next.js 16, RSC | React Router 7 + Vite, SPA | Structural, expected |
| shadcn style preset | `new-york` | `base-nova` | Components look different |
| Base color | `neutral` | `stone` | Different gray temperature |
| Icon library | `lucide` | `tabler` | Same icon ≠ same glyph |
| Sans font | Geist Sans | Manrope Variable / Inter | **Brand mismatch** |
| Mono font | Geist Mono | — | — |
| `--radius` | `0.625rem` | `0.5rem` | Corners differ everywhere |
| Radius scale | `sm`–`xl` | `sm`–`4xl` | Different vocabulary |
| `--primary` | `oklch(0.205 0 0)` (near-black, neutral) | `oklch(0.31 0.07 223)` (blue) | **Different brand color** |
| `--background` | `oklch(1 0 0)` pure white | `oklch(0.988 0.002 95)` warm off-white | Surfaces don't match |
| `--foreground` | `oklch(0.145 0 0)` neutral | `oklch(0.236 0.018 233)` blue-tinted | Text tone differs |
| Semantic colors | `success` / `warning` / `info` (+`-foreground`), `destructive` | `text-*` + `icon-*` `success/warning/error/info`, `destructive` | **Naming clash** |
| `cn()` util alias | `@/lib/cn` | `@/lib/utils` | Copy-paste friction |
| Shared via package | none | none | **Root cause** |

A user moving from the marketing site (`landing`) to the product (`web`) crosses from a blue-accented, Manrope, rounded-`0.5rem` world into a monochrome, Geist, rounded-`0.625rem` world. That is the core inconsistency to resolve.

---

## Findings by category

### A. Design tokens & color

**A1 — Two divergent token palettes (P0).** `--primary`, `--background`, `--foreground`, fonts, and `--radius` all differ between apps (table above). This is the single highest-impact inconsistency.

**A2 — Landing bypasses its own semantic tokens (P0).** `apps/landing/app/app.css` defines accessibility-tuned semantic colors (`--text-success/-warning/-error/-info`, `--icon-*`, commented "APCA 60+"). They are used **0 times**. Instead, components hardcode **58 raw Tailwind palette colors**:

| Color | Uses | | Color | Uses |
|-------|:---:|---|-------|:---:|
| `text-zinc-300` | 8 | | `bg-yellow-500` | 5 |
| `bg-zinc-950` | 8 | | `bg-red-500` | 5 |
| `bg-zinc-900` | 8 | | `text-sky-300` / `purple-400` / `emerald-400` / `blue-400` | 3 each |
| `bg-green-500` | 7 | | `text-amber-400` | 2 |

Concentrated in `components/landing/hero.tsx`, `step-timeline.tsx`, `technical-deep-dive.tsx`, and `routes/{zk-auth,agents,payments}.tsx`. This defeats theming and the stated accessibility goal.

**A3 — Semantic naming clash (P1).** Web names the danger token `destructive` and has `success/warning/info`; landing has `destructive` **and** `error`, plus a `text-*` / `icon-*` split that web lacks. The same concept ("this went wrong") is `destructive` in one app and `error` in the other.

**A4 — Web color discipline is strong (no action).** `apps/web`: **0** raw palette colors; semantic tokens in real use (`success` 40, `warning` 27, `info` 21, `destructive` 83). The 42 hardcoded hex values are confined to legitimate, non-themed surfaces: OG/Twitter images (`opengraph-image.tsx`, `twitter-image.tsx`), PWA manifest/`themeColor`, email HTML (`lib/email/{auth,recovery,ciba}.ts`), the liveness `<canvas>` (`oval-frame.tsx`), confetti (`success-animation.tsx`), and the Google logo (`social-login-buttons.tsx`). Defensible, but currently **ungoverned** (no shared constants) — see C/P2.

### B. Spacing & layout

Both apps are in good shape here.

| | `apps/web` | `apps/landing` |
|---|:---:|:---:|
| Arbitrary spacing/size values (`p-[..]`, `w-[..]`) | 28 | 7 |
| Inline `style={{…}}` | 26 | 0 |
| Ad-hoc spacing offenders | low | very low |

**B1 — Web's arbitrary values are mostly legitimate (no action).** They are shadcn internals: Radix variable widths (`w-[--radix-popover-trigger-width]`), centering (`top-[50%]`, `left-[50%]`), and safe-area `calc()`. The 26 inline styles are **all dynamic runtime values** (e.g. `transform: translateX(-${100 - value}%)` for progress) — correct usage, not hardcoding.

**B2 — Landing has a strong layout-utility layer (keep / promote).** `app.css` defines a clean semantic utility set — `landing-section`, `landing-container`, `landing-card`, `landing-grid-2`, `landing-heading`, `landing-copy`. This is exactly the right pattern; `apps/web` has no equivalent and would benefit from one.

### C. Typography

**C1 — Opposite weight conventions (P1).** Web leans `font-medium`; landing leans `font-semibold`:

| Weight | web | landing |
|--------|:---:|:---:|
| `font-medium` | **122** | 26 |
| `font-semibold` | 18 | **109** |
| `font-bold` | 11 | 8 |

A card title or button label is visibly heavier on the marketing site than in the product.

**C2 — Off-scale micro-typography in landing (P1).** 20 arbitrary font sizes below the Tailwind scale: `text-[13px]`×8, `text-[10px]`×6, `text-[11px]`×5, `text-[0.8rem]`×1. The `10px` sizes also breach a sensible minimum-legible-size floor. Web has only 2 (`text-[11px]`).

**C3 — Fonts differ (rolls up to A1).** Geist (web) vs Manrope/Inter (landing). Resolve as part of the foundation decision.

### D. Component variants & states

**D1 — Four components duplicated and drifting (P0).** `button`, `badge`, `item`, `tabs` exist in **both** `ui/` folders with different presets (`new-york`+lucide vs `base-nova`+tabler) and no shared source. Example drift in `Button`:

| | web `button.tsx` | landing `button.tsx` |
|---|---|---|
| Variants | default, destructive, outline, secondary, ghost, link | same set, **different order** |
| Sizes | default, sm, lg, icon | default, **xs**, sm, lg, icon |
| Icons | lucide | tabler |

Same name, same role, two implementations that must be edited in lock-step but won't be.

**D2 — No shared component/token package (P0, root cause).** `packages/` contains only `@zentity/sdk`. There is nowhere for a shared Button or token set to live, so duplication is the only option today.

**D3 — Component coverage & states are otherwise solid (no action).** `apps/web` ships 31 primitives with `cva` variants on button, badge, alert, item, field, empty, input-group, sidebar. Interaction states are consistent and complete via shadcn defaults (uniform `focus-visible:ring-[3px]`, `disabled:` handling, a dedicated `Spinner`/`Skeleton` for loading). **0 ad-hoc `<button>`** elements in either app — everything routes through the `Button` component.

---

## Token coverage scorecard

| Category | Tokens defined | Hardcoded values found |
|----------|:---:|---|
| Color — web | full semantic set | 0 in components (42 hex in OG/email/canvas/logo only) |
| Color — landing | full set **+ a11y semantics** | **58** raw palette colors; semantic tokens used **0×** |
| Spacing — web | Tailwind scale | 28 arbitrary (≈all legit shadcn internals) |
| Spacing — landing | Tailwind scale + `landing-*` | 7 arbitrary |
| Typography — web | scale + Geist | 2 arbitrary sizes; medium-dominant |
| Typography — landing | scale + Manrope | **20** arbitrary sizes; semibold-dominant |

## Component completeness

| Component | Variants | States | Single-source | Score |
|-----------|:---:|:---:|:---:|:---:|
| Button | ✅ | ✅ | ❌ duplicated | 7/10 |
| Badge | ✅ | ✅ | ❌ duplicated | 7/10 |
| Tabs | ✅ | ✅ | ❌ duplicated | 7/10 |
| Item | ✅ | ✅ | ❌ duplicated | 7/10 |
| web-only primitives (27) | ✅ | ✅ | ✅ (web only) | 9/10 |
| landing semantic colors | ✅ defined | — | ⚠️ unused | 3/10 |

---

## Root cause

Two apps were each independently initialized with `shadcn init` (`new-york`/neutral/lucide vs `base-nova`/stone/tabler) and have evolved in isolation. With **no shared design-token or component package**, every cross-app consistency decision has to be made — and re-made — by hand, so they drift apart by default. Fixing individual colors without fixing this structure will not hold.

---

## Prioritized fix plan

Ordered by impact ÷ effort. P0 = do first (structural), P1 = high-value cleanup, P2 = polish/governance.

### P0 — Establish one source of truth

1. **Decide the canonical brand.** One palette, one primary, one font pairing, one `--radius`. Recommendation: make the **product (`web`) palette canonical** for app surfaces and reconcile landing's blue `--primary` and Manrope font as a deliberate choice (keep, or migrate), not an accident. *Owner: design + eng lead. Effort: S (decision), but unblocks everything.*

2. **Create `packages/ui` (or `packages/design-tokens`).** Move the CSS-variable token block into one importable stylesheet/theme; have both `apps/web/globals.css` and `apps/landing/app.css` import it. *Effort: M.*

3. **Promote the 4 duplicated components** (`button`, `badge`, `tabs`, `item`) into the shared package; delete the local copies; pick one icon library or make icons injectable. Reconcile `Button` sizes (decide whether `xs` is canonical) and variant order. *Effort: M.*

4. **Unify the `cn` util** (`@/lib/cn` vs `@/lib/utils`) to one name/location, exported from the shared package. *Effort: S.*

### P1 — High-value consistency cleanup

5. **Replace landing's 58 raw palette colors with semantic tokens** (`text-success`/`icon-*`/etc.), starting with `hero.tsx`, `step-timeline.tsx`, `technical-deep-dive.tsx`. Restores the intended APCA-60 accessibility. *Effort: M.*

6. **Unify the danger token name** — pick `destructive` *or* `error` across both apps; align the `text-*`/`icon-*` split (adopt it in web, or drop it in landing). *Effort: S–M.*

7. **Pick one font-weight convention** for headings/titles/labels (recommend `font-medium` per the host-UI default and web's existing majority) and codify it in the shared component classes. *Effort: S.*

8. **Replace landing's 20 off-scale font sizes** with scale tokens (`text-xs`/`text-sm`); add `text-2xs` to the theme only if `10–11px` is genuinely required, and audit the `10px` cases for legibility. *Effort: S.*

### P2 — Governance & polish

9. **Centralize the "ungoverned" web hex** (OG image, email, canvas, manifest) into a small typed constants module so brand colors have one home, even where CSS variables can't reach. *Effort: S.*

10. **Add a lint guard** — an ESLint/Biome rule (or `eslint-plugin-tailwindcss`) that fails on raw palette classes (`bg-green-500`) and arbitrary color/size values outside an allowlist, so drift can't silently return. *Effort: S–M.*

11. **Document the system** — one short page: tokens, the type scale, weight convention, and "use the shared `Button`, never a raw `<button>`." Promote landing's `landing-*` utility pattern (or a generalized version) into the shared layer. *Effort: S.*

### Suggested sequencing

```
Week 1   → P0.1 brand decision → P0.2 shared token package → P0.4 cn unify
Week 2   → P0.3 promote 4 shared components → P1.6 token naming
Week 3   → P1.5 landing color migration → P1.7 weights → P1.8 font sizes
Week 4   → P2.9 constants → P2.10 lint guard → P2.11 docs
```

The first three P0 items remove the *mechanism* that produces drift; everything after is cleanup that the lint guard (P2.10) then keeps clean.

---

## Appendix — key file references

- Token definitions: `apps/web/src/app/globals.css`, `apps/landing/app/app.css`
- shadcn config: `apps/web/components.json` (`new-york`/neutral/lucide), `apps/landing/components.json` (`base-nova`/stone/tabler)
- Duplicated components: `*/components/ui/{button,badge,tabs,item}.tsx`
- Landing raw-color hotspots: `app/components/landing/{hero,step-timeline,technical-deep-dive}.tsx`, `app/routes/{zk-auth,agents,payments}.tsx`
- Web governed-hex (leave or centralize): `app/{opengraph-image,twitter-image}.tsx`, `app/manifest.ts`, `lib/email/{auth,recovery,ciba}.ts`, `app/dashboard/verify/_components/liveness/{oval-frame,success-animation}.tsx`
- Shared packages today: `packages/sdk` only (no UI/token package)
