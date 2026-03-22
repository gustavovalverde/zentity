# Landing Page — Design System Rules

This document defines the visual conventions for `apps/landing`. Every component and page must follow these rules to prevent visual drift.

## Color System

All colors flow from `app/lib/colors.ts`:

- `colorStyles` — Record of `SemanticColor` → `{ bg, border, iconText, text }` classes
- `SemanticColor` — `"purple" | "blue" | "emerald" | "amber" | "orange" | "pink" | "red" | "yellow"`

Never hard-code Tailwind color classes (e.g., `text-emerald-500 dark:text-emerald-400`). Always use `colorStyles.emerald.iconText` or the semantic layer below.

### Icon Rendering

Icons are always **bare** — just the icon element with a semantic color class. No background boxes, no borders, no containers around icons.

```tsx
// Correct — bare icon with semantic color
<IconKey className={cn("size-5", colorStyles.amber.iconText)} />

// Wrong — never wrap icons in colored background boxes
<div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
  <IconKey className="size-4 text-amber-500" />
</div>
```

### Concept-to-Color Mapping

`app/lib/icon-semantics.ts` maps **concepts** to `colorStyles.X.iconText` values:

```ts
iconSemanticColors.shield    // purple — ZK/proofs
iconSemanticColors.lock      // blue   — FHE/encryption
iconSemanticColors.commitment // emerald — commitments
iconSemanticColors.key       // amber  — passkeys/custody
iconSemanticColors.compliance // emerald — regulatory
iconSemanticColors.developer // blue   — dev tools
iconSemanticColors.exchange  // orange — crypto
iconSemanticColors.oauth     // purple — OAuth/OIDC
iconSemanticColors.portability // amber — credential portability
```

Use `iconSemanticColors.X` when the icon maps to a known concept. Use `colorStyles[color].iconText` when deriving from a `SemanticColor` value in data arrays.

## Components — When to Use What

### `Badge` (`app/components/ui/badge.tsx`)

Use for numbered step indicators:

```tsx
<Badge variant="outline" className="z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-card p-0 text-sm text-foreground">
  1
</Badge>
```

Never use colored numbered circles with `colorStyles.X.iconText` for step numbers. Steps are neutral.

### `Card` / `Table` (shadcn components)

Always use shadcn `Card`, `CardHeader`, `CardContent`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` — never raw HTML `<table>`, `<section>` with card-like styling, etc.

## CSS Utilities (defined in `app/app.css`)

### Layout

| Utility | Purpose |
|---------|---------|
| `landing-section` | Section padding |
| `landing-band-flat` | White/dark background section |
| `landing-band-muted` | Muted background section (`bg-muted/30`) |
| `landing-container` | Max-width + centering |
| `landing-grid-2` | 2-column responsive grid |

### Cards

| Utility | Purpose |
|---------|---------|
| `landing-card` | `rounded-lg border border-border bg-card` |
| `landing-card-soft` | `rounded-lg border border-border bg-muted/30` — for inner/nested cards |

### Typography

| Utility | Purpose | Maps to |
|---------|---------|---------|
| `font-display` | Headings (Manrope) | `font-family: var(--font-display)` |
| `landing-heading` | Section headings | `text-3xl sm:text-4xl leading-tight` |
| `landing-section-title` | Section title (with font-display) | heading + display font |
| `landing-card-title` | Card title | `font-semibold text-lg leading-snug` |
| `landing-copy` | Descriptive paragraphs | `text-muted-foreground text-sm leading-7 sm:text-base` |
| `landing-body` | Body text in cards | `text-muted-foreground text-sm leading-relaxed sm:text-base` |
| `landing-caption` | Small helper text | `text-muted-foreground text-xs leading-relaxed sm:text-sm` |

Never use raw `text-muted-foreground text-sm` — use `landing-body`. Never use raw `text-muted-foreground text-xs` — use `landing-caption`.

## Sizing

Always use `size-X` instead of `h-X w-X` when width and height are equal:

```tsx
// Correct
<div className="size-8" />
<IconKey className="size-4" />

// Wrong
<div className="h-8 w-8" />
<IconKey className="h-4 w-4" />
```

## Background Opacity

The standard soft background is `bg-muted/30`. Never use `bg-muted/20`, `bg-muted/50`, `bg-card/50`, or `bg-emerald-500/5` for inner card backgrounds. The only exceptions are `bg-muted` (full opacity, for code blocks and input-like surfaces) and `bg-background` (for page-level backgrounds and diagram node boxes).

## Data-Driven Components

When a component renders icons from a data array, store `SemanticColor` (e.g., `"purple"`) and resolve to the color class at render time:

```tsx
const items: Array<{ icon: typeof IconKey; color: SemanticColor }> = [
  { icon: IconKey, color: "amber" },
];

// Render — bare icon, no background box
<item.icon className={cn("size-5", colorStyles[item.color].iconText)} />
```

Exception: tab triggers and other tight inline contexts can store `iconColor: string` from `iconSemanticColors` directly.

## Diagram Nodes

Diagram/schematic boxes (the architecture, key custody, FHE, ZK circuit diagrams) are a special context:

- Icons inside diagram nodes use bare `colorStyles.X.iconText` (same pattern as everywhere else)
- Node subtitles use `text-muted-foreground/70 text-xs` (intentionally more subtle than `landing-caption`)
- Diagram containers use `bg-muted/30` like all other soft backgrounds

## Legal and Platform Pages

- Card corners: `rounded-lg` (not `rounded-xl` or `rounded-2xl`)
- Card backgrounds: `bg-card` (not `bg-card/50`)
- Headings: `font-display font-semibold` (not `font-bold`)
- Body text: `landing-copy` (not raw `text-muted-foreground leading-7`)

## Checklist Before Submitting

1. No raw `h-X w-X` where `size-X` works
2. No hardcoded Tailwind color classes — use `colorStyles` or `iconSemanticColors`
3. Icons are bare (color only, no background boxes or containers)
4. No `bg-card/50`, `bg-muted/20`, `bg-muted/50` — use `bg-muted/30`
5. No raw text styling — use `landing-body`, `landing-copy`, `landing-caption`
6. No raw HTML tables — use shadcn `Table` components
7. `pnpm lint:check` passes
8. `pnpm build` succeeds
