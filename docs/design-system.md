# NightWatch Design Rules

Calm, precise security operations: readable evidence, clear scope, obvious next actions. One visual language serves operational and marketing surfaces; operations favor dense scanning, marketing more whitespace. Each section gives its principle, then only the rules with exact values or easy-to-miss limits.

- Findings cite a numbered rule (e.g. `COL-01`) or a section's principle by its heading. Rules are numbered in order within each section; after adding or removing one, renumber and update every reference.

## Colors

**Principle.** Neutral surfaces with one emerald accent and the same semantic roles in both themes: Canvas, Surface, Text, Secondary text, Control boundary, Primary, On primary, Caution, Danger and Divider. Color always comes with text, an icon, position or line style, and a green action never implies success. Severity, health and freshness stay separate concepts, and no numeric risk threshold is invented. Charts reuse the status roles and label unrelated series directly instead of using a rainbow palette. Respect the user's theme preference.

- COL-01 Solid primary buttons use Primary with On primary. Status badges are neutral Surface with colored text or icon; never white text on dark-theme emerald, never status colors as fills.
- COL-02 Critical and high share Danger with distinct labels and order; medium uses Caution; low, info, unknown and stale are neutral with explicit labels.
- COL-03 Text contrast is at least 4.5:1; essential control and focus boundaries at least 3:1. The dark Control boundary sits at that floor, so never darken it.
- COL-04 Divider is a translucent hairline (about 6–10% of Text in light, 7–10% white in dark) for separators and card edges; it never outlines essential controls or carries meaning alone.

## Typography

**Principle.** One readable sans-serif pairing for Thai and Latin, with monospace only for identifiers, code, timestamps and counts. Thai marks never clip and essential content never shrinks to fit. Numeric columns align, with units, timezone and measurement window where needed. Regular body text, medium or semibold emphasis, natural casing.

- TYP-01 Inter for Latin, Noto Sans Thai for Thai, JetBrains Mono for monospace. Sentences and all Thai text use the sans-serif.
- TYP-02 Body and data 14–16 px, labels 12–14 px, headings 20–28 px, marketing display up to 36–56 px; line height about 1.5.
- TYP-03 Letter-spacing only on small Latin or numeric labels, never on Thai.

## Layout

**Principle.** Each page has a clear title, visible Organization and Project scope and one dominant next action. Group by purpose before adding a container. Depth comes from Canvas/Surface, spacing and a hairline edge. Navigation works without hover, and the active location uses more than color. Canvas may carry a subtle grain on data-dense views, never on Surface.

- LAY-01 Spacing follows a 4 px rhythm (8 / 16 / 24 / 32 px).
- LAY-02 Layouts reflow to narrow screens and 200% text without losing actions or labels; only tables scroll horizontally.
- LAY-03 Targets are at least 24 × 24 px, 44 × 44 px preferred for touch.
- LAY-04 Shadows only on floating overlays (menus, popovers, command palette). Glow only for a live-data indicator or alongside the focus ring.
- LAY-05 Corners are 4 px; full radius only for badges, tags, counters and avatars. Avatars (people) are circular; organization marks, icons and step indicators (system) use 4 px.

## Components

**Principle.** Every pattern shows its real state and adds nothing the assigned flow does not need. One dominant action per group; destructive actions are marked by wording and consequence, not red alone. Tables keep clear headers, aligned values, visible sort and filter context, correct counts and ownership context on small screens.

- CMP-01 Feedback distinguishes loading, no data, no filter matches, restricted, failure, pending and success. Unknown or stale data never looks healthy, current or empty.
- CMP-02 Forms keep persistent labels, errors next to the field, input after failure, a visible pending state and no accidental duplicate submits.
- CMP-03 Overlays have a clear title, dismissal and return path; modals trap focus while open, restore it on close and fit the viewport.
- CMP-04 Collapsed navigation stays keyboard-usable, and closed items are unreachable.
- CMP-05 Evidence labels chart units, timeframe, source and missing data with a non-color summary; demos never appear as live telemetry.

## Accessibility

**Principle.** Everything works by keyboard with visible focus, logical order and meaningful names, and nothing relies on hover, placeholders or color alone. Motion is brief, respects reduced-motion and never hides essential content. Before accepting a design, review both themes, narrow layouts, enlarged text, keyboard and focus, and the relevant error, empty and permission states.

- A11Y-01 The focus indicator stays visible against adjacent surfaces, including primary buttons, with an offset from the fill; a glow never replaces it.
