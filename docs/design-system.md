# NightWatch Design Rules

Calm, precise security operations: readable evidence, clear scope, obvious next actions. One visual language serves operational and marketing surfaces; operations favor dense scanning, marketing more whitespace. Each section gives its principle, then only the rules with exact values or easy-to-miss limits. This document is the source of truth: a codebase copies these values, never the reverse.

- Findings cite a numbered rule (e.g. `COL-01`) or a section's principle by its heading. Rule IDs never change: a new rule takes the next number in its section, and a retired rule keeps its number marked retired.

## Tokens

Nine semantic roles, the same in both themes. Every color in the product comes from this table.

| Role             | Light     | Dark      | Use                                          |
| ---------------- | --------- | --------- | -------------------------------------------- |
| Canvas           | `#f7f8fa` | `#0b0c0e` | Page background                              |
| Surface          | `#ffffff` | `#121316` | Cards, panels, overlays, controls            |
| Text             | `#171a1f` | `#f3f4f6` | Body text, icons                             |
| Secondary text   | `#5b6470` | `#adb5bf` | Descriptions, eyebrows, timestamps           |
| Control boundary | `#7b8490` | `#5b6470` | Input and secondary-button borders           |
| Primary          | `#087a55` | `#3ecf8e` | Primary action fill, focus ring, active icon |
| On primary       | `#ffffff` | `#11251c` | Text on Primary                              |
| Danger           | `#be123c` | `#fb7185` | Destructive and failed states, invalid input |
| Caution          | `#8a5a00` | `#f2be5c` | Medium severity, warnings                    |

Divider is Text at 10% opacity in both themes. Faces: Inter for Latin, Noto Sans Thai (400 / 500 / 600) for Thai, JetBrains Mono for monospace; the faces ship with the product, never from a runtime font CDN. Corners 4 px, controls 40 px high (44 px for the large size), focus ring a 2 px Primary outline offset 2 px from the control, spacing on a 4 px grid.

## Colors

**Principle.** Neutral surfaces with one emerald accent and the same semantic roles in both themes. Color always comes with text, an icon, position or line style, and a green action never implies success. Respect the user's theme preference.

- COL-01 Solid primary buttons use Primary with On primary. Status badges are neutral Surface with colored text or icon; never white text on dark-theme emerald, never status colors as fills.
- COL-03 Text contrast is at least 4.5:1; essential control and focus boundaries at least 3:1. The dark Control boundary sits at that floor, so never darken it.
- COL-04 Divider is a translucent hairline for separators and card edges; it never outlines essential controls or carries meaning alone.

## Typography

**Principle.** One readable sans-serif pairing for Thai and Latin, with monospace only for identifiers, code, timestamps and counts. Thai marks never clip and essential content never shrinks to fit. Numeric columns align, with units, timezone and measurement window where needed. Regular body text, medium or semibold emphasis, natural casing.

- TYP-01 Inter for Latin, Noto Sans Thai for Thai, JetBrains Mono for monospace. Sentences and all Thai text use the sans-serif.
- TYP-02 Body and data 14–16 px, labels 12–14 px, headings 20–28 px, marketing display up to 36–56 px; line height about 1.5.
- TYP-03 Letter-spacing only on small Latin or numeric labels, never on Thai.

## Layout

**Principle.** Each page has a clear title, visible Organization and Project scope and one dominant next action. Group by purpose before adding a container. Depth comes from Canvas/Surface, spacing and a hairline edge. Navigation works without hover, and the active location uses more than color. Canvas may carry a subtle grain on data-dense views, never on Surface.

- LAY-01 Spacing follows a 4 px rhythm (8 / 16 / 24 / 32 px).
- LAY-02 Layouts reflow to narrow screens and 200% text without losing actions or labels. The page never scrolls sideways; only a table, a tab strip or a step indicator may scroll horizontally inside its own container, and it never shows a vertical scrollbar of its own.
- LAY-03 Targets are at least 24 × 24 px. Controls are 40 px high; the large size and touch-first surfaces use 44 px.
- LAY-04 Shadows only on floating overlays (menus, popovers, command palette). Glow only for a live-data indicator or alongside the focus ring.
- LAY-05 Corners are 4 px; full radius only for badges, tags, counters and avatars. Avatars (people) are circular; organization marks, icons and step indicators (system) use 4 px.

## Components

**Principle.** Every pattern shows its real state and adds nothing the assigned flow does not need. One dominant action per group; destructive actions are marked by wording and consequence, not red alone. Tables keep clear headers, aligned values, visible sort and filter context, correct counts and ownership context on small screens.

- CMP-01 Feedback distinguishes loading, no data, no filter matches, restricted, failure, pending and success. Unknown or stale data never looks healthy, current or empty.
- CMP-02 Forms keep persistent labels, errors next to the field, input after failure, a visible pending state and no accidental duplicate submits.
- CMP-03 Overlays have a clear title, dismissal and return path; modals trap focus while open, restore it on close and fit the viewport.
- CMP-04 Collapsed navigation stays keyboard-usable, and closed items are unreachable.

## Accessibility

**Principle.** Everything works by keyboard with visible focus, logical order and meaningful names, and nothing relies on hover, placeholders or color alone. Motion is brief, respects reduced-motion and never hides essential content. Before accepting a design, review both themes on desktop, keyboard and focus, and the relevant error, empty and permission states. Narrow layouts and enlarged text follow LAY-02 in implementation and are checked only when a user reports a problem or asks for it.

- A11Y-01 The focus indicator stays visible against adjacent surfaces, including primary buttons, with an offset from the fill; a glow never replaces it.

## Evidence surfaces

Apply when a surface shows findings, severity, health, freshness or charts. Severity, health and freshness stay separate concepts, and no numeric risk threshold is invented. Charts reuse the status roles and label unrelated series directly instead of using a rainbow palette.

- COL-02 Critical and high share Danger with distinct labels and order; medium uses Caution; low, info, unknown and stale are neutral with explicit labels.
- CMP-05 Evidence labels chart units, timeframe, source and missing data with a non-color summary; demos never appear as live telemetry.
