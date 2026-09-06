# Design System

## 1. Scope

Use [technology guidance](tech.md) and [architecture guidance](architecture.md) with this reference.

Keep surfaces independent:

| Surface | Design scope | Reuse |
| --- | --- | --- |
| Web | Dense operational UI; light/dark themes, tables, forms, navigation rail | Web tokens, tone maps, React primitives |
| Landing | Dark marketing UI; large headings, demonstrations, gradients, reveal motion | `--landing-*`, `.landing-*`, Astro components |

Do not import web primitives or CSS into landing. Keep deployments independent; require an architecture decision to combine design systems.

## 2. Fonts

Preserve stack order:

| Surface / token | Family stack |
| --- | --- |
| Web `--font-sans` | `"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"` |
| Web `--font-mono` | `"JetBrains Mono", "IBM Plex Mono", "SFMono-Regular", ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace` |
| Landing `--font-sans` | `"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"` |
| Landing `--font-mono` | `"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, "Cascadia Code", "Source Code Pro", monospace` |

For landing, request Inter `400;500;600;700;800` and JetBrains Mono `400;500;600` with `display=swap`. Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`; set `crossorigin` on the latter.

```text
https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap
```

## 3. Web: semantic colors and themes

### Theme preference

- Support `ThemePreference`: `system | light | dark`; default missing/invalid values to **`dark`**.
- Persist in `localStorage['nightwatch.account.theme']`; label choices `System`, `Light`, `Dark`. Describe storage as device/browser-origin-local, not account API synchronization.
- Resolve `system` through `matchMedia('(prefers-color-scheme: dark)')` and follow OS changes. Fall back to dark without browser/media-query support.
- Toggle `dark` on `document.documentElement`; use `:root` for light. Match native control color schemes.
- Check initial paint, reload, storage denial, and agreed cross-tab behavior; preference storage alone guarantees none of these.

### Base, surfaces, and brand

Preserve OKLCH values exactly. Names omit `--`; map through `@theme inline` to semantic utilities (`bg-background`, `text-muted-foreground`, `border-border`, `ring-ring`).

| Token | Light (`:root`) | Dark (`.dark`) |
| --- | --- | --- |
| `background` | `oklch(0.985 0.002 247.85)` | `oklch(0.135 0.008 245)` |
| `foreground` | `oklch(0.21 0.004 247.85)` | `oklch(0.98 0.004 245)` |
| `surface-1` | `oklch(0.975 0.002 247.85)` | `oklch(0.17 0.009 245)` |
| `surface-2` | `oklch(0.96 0.003 247.85)` | `oklch(0.195 0.01 245)` |
| `card` | `oklch(1 0 0)` | `oklch(0.185 0.01 245)` |
| `card-foreground` | `oklch(0.21 0.004 247.85)` | `oklch(0.98 0.004 245)` |
| `popover` | `oklch(1 0 0)` | `oklch(0.205 0.01 245)` |
| `popover-foreground` | `oklch(0.21 0.004 247.85)` | `oklch(0.98 0.004 245)` |
| `border` | `oklch(0.91 0.003 247.85)` | `oklch(0.285 0.012 245)` |
| `border-strong` | `oklch(0.84 0.005 247.85)` | `oklch(0.38 0.014 245)` |
| `muted` | `oklch(0.965 0.003 247.85)` | `oklch(0.22 0.01 245)` |
| `muted-foreground` | `oklch(0.52 0.005 247.85)` | `oklch(0.7 0.014 245)` |
| `subtle-foreground` | `oklch(0.55 0.005 247.85)` | `oklch(0.55 0.012 245)` |
| `accent` | `oklch(0.96 0.003 247.85)` | `oklch(0.26 0.012 245)` |
| `accent-foreground` | `oklch(0.21 0.004 247.85)` | `oklch(0.98 0.004 245)` |
| `primary` | `oklch(0.52 0.17 152.4)` | `oklch(0.85 0.16 162)` |
| `primary-foreground` | `oklch(1 0 0)` | `oklch(0.15 0.03 162)` |
| `primary-soft` | `oklch(0.88 0.06 152.4)` | `oklch(0.36 0.06 162)` |
| `secondary` | `oklch(0.95 0.025 153)` | `oklch(0.26 0.018 162)` |
| `secondary-foreground` | `oklch(0.32 0.09 152.4)` | `oklch(0.89 0.08 162)` |
| `input` | `oklch(1 0 0)` | `oklch(0.175 0.01 245)` |
| `ring` | `oklch(0.52 0.17 152.4)` | `oklch(0.85 0.16 162)` |

Use web `accent` for neutral interaction surfaces and `primary` for mint. Landing `landing-accent` means mint.

### Status and severity

| Token | Light | Dark |
| --- | --- | --- |
| `destructive` | `oklch(0.57 0.22 27.5)` | `oklch(0.74 0.19 22)` |
| `destructive-foreground` | `oklch(1 0 0)` | `oklch(0.16 0.02 22)` |
| `info` | `oklch(0.54 0.15 244.25)` | `oklch(0.78 0.13 244)` |
| `info-foreground` | `oklch(1 0 0)` | `oklch(0.88 0.08 244)` |
| `health-healthy` | `oklch(0.72 0.17 152.4)` | `oklch(0.85 0.16 162)` |
| `health-healthy-foreground` | `oklch(0.4 0.12 152.4)` | `oklch(0.91 0.1 162)` |
| `health-warning` | `oklch(0.78 0.16 80)` | `oklch(0.85 0.15 84)` |
| `health-warning-foreground` | `oklch(0.45 0.12 80)` | `oklch(0.92 0.08 84)` |
| `health-unknown` | `oklch(0.65 0.01 247.85)` | `oklch(0.72 0.014 245)` |
| `health-unknown-foreground` | `oklch(0.42 0.008 247.85)` | `oklch(0.84 0.012 245)` |
| `health-stale` | `oklch(0.65 0.05 285.12)` | `oklch(0.7 0.04 285)` |
| `health-stale-foreground` | `oklch(0.4 0.05 285.12)` | `oklch(0.84 0.032 285)` |
| `severity-critical` | `oklch(0.57 0.22 27.5)` | `oklch(0.74 0.19 22)` |
| `severity-critical-foreground` | `oklch(0.5 0.19 27.5)` | `oklch(0.74 0.19 22)` |
| `severity-high` | `oklch(0.68 0.18 45.5)` | `oklch(0.8 0.16 48)` |
| `severity-high-foreground` | `oklch(0.5 0.14 45.5)` | `oklch(0.8 0.16 48)` |
| `severity-medium` | `oklch(0.78 0.16 84.2)` | `oklch(0.87 0.15 86)` |
| `severity-medium-foreground` | `oklch(0.47 0.11 84.2)` | `oklch(0.87 0.15 86)` |
| `severity-low` | `oklch(0.62 0.15 244.25)` | `oklch(0.78 0.13 244)` |
| `severity-low-foreground` | `oklch(0.48 0.12 244.25)` | `oklch(0.78 0.13 244)` |

Use shared tone maps and `StatusBadge`:

- Severity: `bg-severity-*`, `text-severity-*-foreground`, subtle fill `/10`, border `/20`. Map informational to muted; add no `severity-informational` token.
- Health: `healthy | warning | critical | unknown | stale`. Map critical to destructive; add no `--health-critical` token.
- Badge tones: `severity | health | scan | result`. Normalize values, retain labels, use neutral unknown-value fallbacks, and hide decorative dots from assistive technology.
- Pair severity foregrounds with subtle fills, not arbitrary saturated fills.

### Charts

Reuse semantic colors; do not add a numbered chart palette.

- Posture: `stroke-border` grids; healthy scores `≥90`, warning `≥70`, destructive below `70`; `stroke-primary` fallback. Name charts accessibly and give markers meaningful titles.
- Monitor sparklines: healthy up, warning degraded, destructive down, `border/50` unknown. Keep 60 columns, default minimum width `220px`, and a status-count summary.
- Keep display thresholds separate from business classification. Verify data/aggregation; label illustrations, never present them as live analytics.

## 4. Web: typography, spacing, radius and shadows

### Typography

| Utility / element | Size | Line height | Use |
| --- | --- | --- | --- |
| `body` | `13px` | `1.45` | Base sans, antialiased |
| `text-kicker` | `10px` | `14px` | Field labels, table headers, rail group labels; uppercase, semibold, `tracking-kicker` (`0.08em`) |
| `text-body-sm` | `11px` | `16px` | Supporting text, small buttons, mono table cells |
| `text-body` | `12px` | `16px` | Inputs, regular buttons, tables, navigation |
| `text-title-sm` | `13px` | `16px` | Card/drawer titles; use `leading-tight` only where composition requires it |
| `text-page-title` | `22px` | `24px` | Page titles |
| `text-display` | `22px` | `24px` | Metrics |

Keep body `13px` distinct from `text-body` `12px`. Use `font-mono` for identifiers/metrics and `tabular-nums` for aligned numbers.

Use `cn` with `clsx` and `extendTailwindMerge`; register custom text sizes so merging retains both size and text color.

### Spacing and radius

| Token / pattern | Value | Use |
| --- | --- | --- |
| `--space-page` / `p-page` | `1.5rem` | Both themes |
| `--space-section` / `gap-section` | `1rem` | Section spacing |
| `--table-row-height` | `2.25rem` | Spacing `table-row`; regular table rows `h-9` |
| `--table-row-compact` | `2rem` | Compact data-table rows `h-8` |
| `--radius` | `0.375rem` | `rounded-lg` |
| `--radius-sm` | `calc(var(--radius) - 4px)` | `2px` at root font size `16px` |
| `--radius-md` | `calc(var(--radius) - 2px)` | `4px` at root font size `16px`; Card/Input/Button `rounded-md` |
| `--radius-xl` | `calc(var(--radius) + 4px)` | `10px` at root font size `16px` |
| Card | Header/footer `px-4 py-3`; content `px-4 pb-3 pt-3` | Preserve composition-specific padding |
| Form field | `FieldLabel` wrapper `space-y-1.5`; forms `space-y-4` or `space-y-2` | Select spacing for the composition |

Use ordinary Tailwind spacing (`gap-1.5`, `px-3`, `h-7`) alongside tokens; do not add a parallel scale or universal form grid.

### Shadows

| Token | Light | Dark |
| --- | --- | --- |
| `--shadow-sm` | `0 1px 2px oklch(0 0 0 / 0.06)` | `0 1px 2px oklch(0 0 0 / 0.25)` |
| `--shadow-md` | `0 4px 12px oklch(0 0 0 / 0.08)` | `0 4px 12px oklch(0 0 0 / 0.35), inset 0 1px 0 oklch(1 0 0 / 0.03)` |
| `--shadow-lg` | `0 20px 40px oklch(0 0 0 / 0.12)` | `0 20px 40px oklch(0 0 0 / 0.45), inset 0 1px 0 oklch(1 0 0 / 0.03)` |

Use `shadow-[var(--shadow-sm)]` for cards; `shadow-[var(--shadow-lg)]` for modals, drawers, and expanded rail.

## 5. Web: primitives and composition

| Component | Contract |
| --- | --- |
| `Button` | Variants `default`, `outline`, `destructive`, `ghost`, `link`; default `h-7 px-2.5 text-body`, sm `h-6 px-2 text-body-sm`, lg `h-9 px-3.5 text-title-sm`, icon `h-7 w-7`. Default `type="button"`; `asChild` uses Radix Slot. |
| Card family | Compose `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`; border and themed fill. Fit the `h3` title into page hierarchy. |
| `Table` | Native elements, horizontal overflow, header `h-8`, cells `h-9`, hover fill; `flush` removes the outer border inside cards. |
| `DataTable` | Column render/align/mono/sortable/width, supplied-data sorting, compact density, skeleton, empty state, optional controlled pagination. Distinguish page counts from record counts. |
| `Input` / `NativeSelect` | `h-7`, `bg-input`, `rounded-md`, primary focus border, ring `/30`, disabled and `aria-invalid` styles. Keep select native; size wrapper and control consistently. |
| `FieldLabel` | Match `htmlFor` to control ID; an unassociated span or spacing wrapper is not a label. |
| `Switch` | Radix Switch `h-5 w-9`, thumb `h-4 w-4`, primary checked fill, border-strong unchecked fill; accessible label. |
| `StatusBadge` | Shared tones, visible text, optional decorative dot. |
| `EmptyState` | Title, description, icon, action, compact mode; decorative default Inbox icon. |
| `ListPageShell` | Section with `mx-auto max-w-7xl space-y-4`. |
| `PageTabs` | Wrapping section buttons, primary active underline, `aria-current="page"`; not an ARIA tablist without its full interaction pattern. |
| `Dialog` | Associated title/description, `role="dialog"`, `aria-modal`, Escape/backdrop dismissal, scroll lock, focus restoration. Default `max-w-md`, `p-5`, maximum height `calc(100dvh - 2rem)`; do not assume Radix behavior. |
| `DetailDrawer` | Right panel, default `560px`, maximum `100vw`; title, subtitle, badge, internal scroll, close control. Apply modal focus, Escape, and scroll rules. |

Compose `Dialog` → `form` → labelled controls → `DialogFooter`. Reuse fields and a styled native textarea; abstract only for demonstrated reuse. Show `Saving…`, prevent duplicate submits, retain input on failure, and provide validation/recovery feedback.

Cover loading, empty, recoverable error, pending/disabled, validation, focus, permission, and success states as applicable.

Compose cards and labels:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Finding severity</CardTitle>
    <StatusBadge dot tone="severity" value="high" />
  </CardHeader>
  <CardContent>
    <p className="text-body text-muted-foreground">Review the affected resource.</p>
    <Button className="mt-3" variant="outline">Review</Button>
  </CardContent>
</Card>
```

```tsx
<FieldLabel htmlFor="resource-name" label="Resource name">
  <Input id="resource-name" name="resourceName" />
</FieldLabel>
```

Link validation messages with `aria-describedby`; set `aria-invalid`. Styling alone creates neither association.

## 6. Web: navigation, responsive behavior and accessibility

### Layout and navigation

- At `lg`, expand the `52px` rail to `208px` on hover, focus-within, or descendant `data-state=open`; reveal labels in every state.
- Below `lg`, use a `208px` left sidebar/backdrop. Label controls; support Escape, focus containment/restoration, and remove closed navigation from focus/accessibility exposure.
- Mark active rail items with `color-mix(in oklab, var(--primary) 14%, transparent)`, a left marker, and foreground text.
- Keep a sticky `h-12` header; main `px-4 py-4`, then `sm:px-page sm:py-page`. Use `max-w-7xl` unless `staticData.fullWidth`.
- Use two dashboard chart columns at `xl`; prefer proportional layouts such as `minmax(0,2fr)` / `minmax(300px,1fr)`.
- Contain table overflow. Stack pagination before `sm`, then use a row. Bound dialogs/drawers to the viewport.

### Interaction and content

- Use button focus-visible rings `2px` with `2px` offset, input/select ring `/30`, and `focus-visible:focus-ring` elsewhere.
- Set table headers `scope="col"`, expose `aria-sort` and `aria-busy`, name sort buttons, and support Enter/Space on clickable rows.
- Share Dialog/DetailDrawer focus trapping; check Tab/Shift+Tab, eligible targets, restoration, nested overlays, and scroll-lock release.
- Pair status colors with text; give charts accessible names and non-color summaries.
- Map `.prose` to semantic tokens: light links secondary-foreground, dark links primary, fenced code muted.
- Check reduced motion for `200ms` overlays and critical `animate-pulse`; inspect dense `h-6` controls and `10px` kickers for zoom, touch usability, and clipping.

## 7. Landing: isolated dark marketing system

### Theme and palette

Keep `:root { color-scheme: dark; }`; add no theme provider, stored preference, or OS switching.

Preserve these 24 tokens. Names omit `--landing-`; combined names share a value.

| Token | Dark value |
| --- | --- |
| `bg` | `oklch(0.135 0.008 245)` |
| `surface` | `oklch(0.17 0.009 245)` |
| `surface-2`, `surface-raised` | `oklch(0.195 0.01 245)` |
| `card` | `oklch(0.185 0.01 245)` |
| `fg` | `oklch(0.98 0.004 245)` |
| `fg-muted` | `oklch(0.7 0.014 245)` |
| `fg-subtle` | `oklch(0.55 0.012 245)` |
| `border-soft`, `border-subtle` | `oklch(0.23 0.01 245)` |
| `border` | `oklch(0.285 0.012 245)` |
| `border-strong` | `oklch(0.38 0.014 245)` |
| `accent` | `oklch(0.85 0.16 162)` |
| `accent-hover` | `oklch(0.8 0.17 162)` |
| `accent-ink` | `oklch(0.15 0.03 162)` |
| `accent-soft` | `oklch(0.36 0.06 162)` |
| `accent-border` | `color-mix(in oklch, var(--landing-accent) 25%, transparent)` |
| `info` | `oklch(0.78 0.13 244)` |
| `warning` | `oklch(0.87 0.15 86)` |
| `critical` | `oklch(0.74 0.19 22)` |
| `high` | `oklch(0.8 0.16 48)` |
| `health-healthy` | `var(--landing-accent)` |
| `health-warning` | `var(--landing-warning)` |
| `health-critical` | `var(--landing-critical)` |

Highlight code with `.tok-k` `oklch(0.8 0.16 300)`, `.tok-n` `oklch(0.85 0.12 86)`, `.tok-s` accent, `.tok-c` fg-subtle; keep syntax colors separate from chart semantics.

### Typography, surfaces, and rhythm

| Pattern | Contract |
| --- | --- |
| Base body | Sans `15px / 1.55` |
| Hero `h1` | `clamp(2.6rem,5.2vw,4rem)`, bold, line-height `1.04`, tracking-tight |
| Hero description | `text-base`, `leading-relaxed`, increasing to `md:text-lg` |
| Stat label | Mono `9px`, uppercase, tracking `0.1em`, weight `600` |
| Stat value | Mono `22px`, weight `700`, line-height `1.1`, tracking `-0.01em` |
| Stat foot | `10px` |
| Severity chip | Mono `9px`, weight `600`, uppercase, tracking `0.05em`, padding `2px 6px`, radius `3px`; severity background color-mix `22%` |
| `.landing-card` | Card background, `1px` border, `12px` radius, shadow-card |
| `.landing-stat-card` | Surface background, `8px` radius, padding `10px 12px`, gap `4px` |
| `.landing-code` | Bg background, `1px` border, `10px` radius, mono `12px`; header `11px` with padding `8px 14px`; body padding `14px 16px`, line-height `1.7`, horizontal scrolling |
| Hero container | `max-w-6xl`, gap `12`, padding `px-6 pt-16 pb-20`; `md:px-8 md:pt-24 md:pb-28`; `lg:grid-cols-[1.05fr_1fr]` |
| Hero CTA | `rounded-md`, `px-5 py-3`, `text-sm`; primary accent + accent-ink, secondary transparent + border; stack before `sm`, then arrange in a row |

Reuse `.landing-card`, `.landing-sev`, `.landing-code`, and Astro compositions, not dense web controls or a new universal spacing/radius scale.

Preserve shadows:

```css
--landing-shadow-card:
  inset 0 1px 0 0 color-mix(in oklch, white 4%, transparent),
  0 8px 24px -12px rgb(0 0 0 / 0.3),
  0 28px 72px -28px rgb(0 0 0 / 0.35);
--landing-shadow-float:
  inset 0 1px 0 0 color-mix(in oklch, white 5%, transparent),
  0 12px 32px -16px rgb(0 0 0 / 0.35),
  0 56px 140px -40px rgb(0 0 0 / 0.45),
  0 0 96px -32px color-mix(in oklch, var(--landing-accent) 16%, transparent);
```

Use `.landing-card--float` for shadow-float. Keep hero radial accents `12%`, info `8%`, grid textures `60px`/`40px`, and composition-specific masked glow.

Compose under `BaseLayout` with landing styles:

```astro
<article class="landing-card p-6">
  <span class="landing-sev landing-sev--high">High</span>
  <p class="mt-3 text-[var(--landing-fg-muted)]">Review the affected resource.</p>
</article>
```

### Navigation, motion, and progressive rendering

- Use sticky `z-50` navigation, `max-w-6xl`, translucent fill/backdrop blur; show desktop links at `md`.
- Keep mobile navigation a non-modal disclosure: `aria-controls`, accurate `aria-expanded`, open/close label, Escape, consistent `hidden` state. Check dismissal focus and hidden-link exclusion; do not apply modal focus containment.
- Preserve `--landing-ease: cubic-bezier(0.22, 1, 0.36, 1)` and `160ms`, `320ms`, `640ms` durations.
- Gate `.landing-reveal` hiding behind `html.js`: opacity `0`, `translateY(16px)`, then one-time IntersectionObserver `is-visible`. Show final state immediately without IntersectionObserver or with reduced motion.
- For reduced motion, disable reveals/pulse dots and skip stat count-up; otherwise count up over `900ms` at observer threshold `0.6`. Check scrolling and navigation transitions too.
- Keep content visible and navigation reachable without JavaScript.

## 8. Limitations and design decisions

- Resolve web font delivery/privacy before adding assets or providers. Declarations do not ensure loading; verify weights, fallbacks, glyph coverage, and required languages. No stack specifies a Thai family.
- Landing requests mono through `600`, but stat values specify `700`; verify rendering and explicitly decide any loading-policy change.
- Measure contrast on rendered fills, opacity, and interaction states in both web themes and landing dark. Tokens alone do not establish accessibility compliance.
- Require separate design and verification for landing light mode; do not borrow web light tokens.

## 9. UI change checklist

- Preserve surface boundaries, exact tokens, font stacks, and reusable composition contracts.
- Inspect changed layouts in web light/dark or landing dark, at relevant breakpoints and zoom; check overflow and font fallbacks.
- Exercise affected states, keyboard/focus, labels/errors, sorting, hidden navigation, and chart alternatives.
- Check contrast and reduced motion on the actual surface; report unavailable checks without claiming compliance.
