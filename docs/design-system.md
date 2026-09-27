# NightWatch Design Rules

Calm, precise security operations: readable evidence, clear scope, obvious next actions. One visual language for operational and marketing surfaces; operations favor dense scanning, marketing more whitespace. Token values live in `apps/web/src/index.css`; this file holds the rules.

## Colors

Semantic roles, same in both themes: Canvas, Surface, Text, Secondary text, Control boundary, Primary/positive (one emerald accent), On primary, Caution, Danger, Divider.

- Neutral surfaces with one emerald accent; no neon, decorative gradients, excess cards or filler color.
- Solid primary buttons use Primary + On primary. Status badges are neutral Surface with colored text/icon; never white text on dark-theme emerald, never status colors as arbitrary fills.
- Critical/high share Danger with distinct labels and order; medium uses Caution; low/info/unknown/stale are neutral with explicit labels. Severity, health and freshness stay separate concepts.
- Pair color with text, icon, position or line style. A green action does not mean success; never invent numeric risk thresholds.
- Charts reuse the status roles; unrelated series use direct labels and line/marker styles, not a rainbow palette.
- Divider is a translucent hairline (about 6–10% of Text in light, 7–10% white in dark) for row separators, card/panel edges and secondary button borders; it never replaces Control boundary on essential controls or carries meaning alone.
- Contrast floors: text ≥ 4.5:1; essential control and focus boundaries ≥ 3:1. The dark Control boundary sits at the 3:1 floor, so never darken it. Recheck real combinations, states and transparency.
- Respect the user's theme preference and keep hierarchy and state meaning in both themes.
- Keep Organization and Project context visible; distinguish observed, incomplete and illustrative data.

## Typography

- Sans-serif with compatible Thai and Latin: Inter for Latin, Noto Sans Thai for Thai. Monospace (JetBrains Mono) only for identifiers, code, timestamps and counts; sentences and all Thai stay sans-serif.
- Tracking only on small Latin/numeric labels, never on Thai or enough to clip Thai marks.
- Sizes: body/data 14–16 px, labels 12–14 px, headings 20–28 px, marketing display up to 36–56 px. Never shrink essential content to fit.
- Regular body, medium/semibold emphasis, line height about 1.5 so Thai marks never clip; natural casing.
- Align numeric columns; show units, timezone and measurement window where needed.

## Layout

- 4 px rhythm (8 / 16 / 24 / 32 px); group by purpose before adding a container.
- Each page has a clear title, visible scope and one dominant next action. Navigation works without hover, and the active location uses more than color.
- Reflow to narrow screens and 200% text without losing actions or labels; contain table scrolling, never the whole page horizontally.
- Targets at least 24 × 24 px (44 × 44 px preferred for touch); density never means tiny text or targets.
- Depth comes from Canvas/Surface, spacing and a hairline edge, not shadows. Shadows only on floating overlays (menus, popovers, command palette). Glow only for a live-data indicator or alongside the focus ring.
- 4 px corners for controls, panels and overlays; full radius only for status badges/tags, counters and avatars. Avatars (people) are circular; organization marks, icons and step indicators (system) use 4 px.
- An optional subtle Canvas grain (about 4–5% opacity) on data-dense views; never on Surface or competing with content.

## Components

- Actions: one dominant action per group; destructive actions are marked by wording and consequence, not red alone.
- Forms: persistent labels, errors next to the field, input kept on failure, visible pending state, no accidental duplicate submits.
- Tables: clear headers, aligned values, visible sort/filter context, correct count meaning; keep ownership/context on small screens.
- Navigation: stable labels and current location; collapsed navigation stays keyboard-usable and closed items are unreachable.
- Overlays: clear title, dismissal and return path; modals trap and restore focus and fit the viewport.
- Feedback: distinguish loading, no data, no filter matches, restricted, failure, pending and success. Unknown or stale data never looks healthy, current or empty.
- Evidence: label chart units, timeframe, source and missing data with a non-color summary; never present demos as live telemetry.
- Use only the states the assigned flow needs; a pattern is not permission to add features.

## Accessibility

- Keyboard operation with visible focus, logical order and meaningful names; never rely on hover, placeholders or color alone.
- The focus indicator stays visible against adjacent surfaces, including primary buttons, with an offset from the fill; a glow never replaces it.
- Brief, purposeful motion that respects reduced-motion and never hides essential content.
- Before accepting a design, review both themes, narrow layouts, enlarged text, keyboard/focus and relevant error, empty and permission states.
