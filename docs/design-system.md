# NightWatch Design Rules

Calm, precise security operations: readable evidence, clear scope, obvious next actions. One visual language serves operational and marketing surfaces; operations favor dense scanning, marketing more whitespace. Each section gives its principle, then only the rules with exact values or easy-to-miss limits. This document is the source of truth: a codebase copies these values, never the reverse.

- Findings cite a numbered rule (e.g. `COL-01`) or a section's principle by its heading. Rule IDs never change: a new rule takes the next number in its section, and a retired rule keeps its number marked retired.

The reference canvas is [Claude Design](https://claude.ai/artifact/2Rc9dSWEvHwrM1zrFeFchF), private until shared. This document is the source of truth where the canvas and these rules disagree.

## Tokens

Ten semantic roles, the same in both themes. Every color in the product comes from this table, its derived levels below, or a rule that states its exact value (On danger in COL-05, the modal shadow in LAY-07).

| Role             | Light     | Dark      | Use                                                              |
| ---------------- | --------- | --------- | ---------------------------------------------------------------- |
| Canvas           | `#f7f8fa` | `#0b0c0e` | Page background                                                  |
| Surface          | `#ffffff` | `#0e0f12` | Cards, panels, overlays, controls                                |
| Text             | `#171a1f` | `#f3f4f6` | Body text, icons                                                 |
| Heading          | `#171a1f` | `#ffffff` | Page and card titles                                             |
| Secondary text   | `#5b6470` | `#adb5bf` | Descriptions, timestamps, section codes                          |
| Control boundary | `#7b8490` | `#5b6470` | Input and secondary-button borders                               |
| Primary          | `#087a55` | `#3ecf8e` | Primary action fill, focus ring, active icon, link text, eyebrow |
| On primary       | `#ffffff` | `#11251c` | Text on Primary                                                  |
| Danger           | `#be123c` | `#fb7185` | Destructive and failed states, invalid input                     |
| Caution          | `#8a5a00` | `#f2be5c` | Medium severity, warnings                                        |

Divider is Text at 10% opacity in both themes. Derived levels are opacities of a role, never new colors:

- Inset levels: Text at 4% (inset), 5% (hover) and 8% (active) over Canvas or Surface; tint fills only, never borders.
- Strong edge: Text at 20%, for pill, tag, avatar, system mark (monitor initial tile, read-notification dot, status dot, no-data strip cell) and dashed mockup-frame (CMP-06) edges only; essential controls keep Control boundary (COL-04).
- Primary tint: Primary at 12% (dark) and 8% (light), only behind the active navigation row and a selected filter chip. Primary text on it measures 8.17:1 (dark) and 4.52:1 (light, over Canvas), so it meets COL-03.

Faces: Inter for Latin, Noto Sans Thai (400 / 500 / 600) for Thai, JetBrains Mono for monospace; the faces ship with the product, never from a runtime font CDN. Corners 4 px, controls 40 px high (44 px for the large size, 32 px for the small size per LAY-06), focus ring a 2 px Primary outline offset 2 px from the control, spacing on a 4 px grid.

## Colors

**Principle.** Neutral surfaces with one emerald accent and the same semantic roles in both themes. Color always comes with text, an icon, position or line style, and a green action never implies success. Respect the user's theme preference.

- COL-01 Solid primary buttons use Primary with On primary. Status badges are neutral Surface with colored text or icon; never white text on dark-theme emerald, never status colors as badge fills.
- COL-03 Text contrast is at least 4.5:1; essential control and focus boundaries at least 3:1. The dark Control boundary sits at that floor, so never darken it.
- COL-04 Divider is a translucent hairline for separators and card edges; it never outlines essential controls or carries meaning alone.
- COL-05 Danger fill with On danger text (light `#ffffff` at 6.29:1, dark `#2a0a12` at 6.78:1) is allowed only for the confirm button inside a confirmation dialog. Inline two-step confirms use the Danger outline button: Surface background, 1 px Danger border, Danger text (light `#be123c` on `#ffffff` at 6.29:1, dark `#fb7185` on `#0e0f12` at 7.12:1) and a Danger tint on hover. The wording and the stated consequence stay required, so color is never the only destructive cue.
- COL-06 An alert banner for a down or failed state may use a Danger border and Danger at 10% (dark) / 6% (light) as fill, with an icon and a written state. Badges and status pills stay neutral (COL-01).

## Typography

**Principle.** One readable sans-serif pairing for Thai and Latin, with monospace only for identifiers, code, timestamps and counts. Thai marks never clip and essential content never shrinks to fit. Numeric columns align, with units, timezone and measurement window where needed. Regular body text, medium or semibold emphasis, natural casing.

- TYP-01 Inter for Latin, Noto Sans Thai for Thai, JetBrains Mono for monospace. Sentences and all Thai text use the sans-serif.
- TYP-02 Body and data 14–16 px, labels 12–14 px, page titles 28 px, section headings 16 px semibold, other headings 20–28 px, marketing display up to 36–56 px; line height about 1.5.
- TYP-03 Letter-spacing only on small Latin or numeric labels, never on Thai.
- TYP-04 Monospace, letter-spacing and uppercase apply per run and only to Latin tokens (identifiers, numbers, units, times, URLs, route codes); Thai in the same line stays in the sans-serif without tracking. Labels are Thai, and values (counts, ids, times, URLs) are set in JetBrains Mono. English appears only in eyebrow and route-code tokens, in the CMP-06 issue link ("ดู issue #N"), in `slug`, in product names read from the user agent (browser, OS) and as Latin technical terms, for example metric ids (`p50`, `p95`, `ms`), protocol and format names (`HTTP`, `DNS`, `TLS`, `SSL`, `TTFB`, `URL`, `API`, `JSON`, `JSONPath`, IANA zone names), HTTP request parts (header, body, query parameter) and auth schemes (`MFA`, `TOTP`, Bearer, Basic, token). Plain-word labels such as Method, Uptime, Status or Tags are written in Thai (`เมธอด`, `ความพร้อมใช้งาน`). A page eyebrow is an optional Latin route code (e.g. `// overview`) in monospace Primary, 12 px, uppercase, tracking at most 0.12em. A section code (`01`, `02`) may prefix an h2 in monospace Secondary text; it is `aria-hidden` and never the heading's only name.

## Layout

**Principle.** Each page has a clear title, visible Organization and Project scope and one dominant next action. Group by purpose before adding a container. Depth comes from Canvas/Surface, spacing and a hairline edge. Navigation works without hover, and the active location uses more than color. Canvas may carry a subtle grain (1 px dots at Text 4% on a 24 px grid) on data-dense views, never on Surface. A hairline grid (cells separated by 1 px Divider gaps, cells on Surface) may group sibling stats or rows.

- LAY-01 Spacing follows a 4 px rhythm (8 / 16 / 24 / 32 px).
- LAY-02 Layouts reflow to narrow screens and 200% text without losing actions or labels. The page never scrolls sideways; only a table, a tab strip or a step indicator may scroll horizontally inside its own container, and it never shows a vertical scrollbar of its own.
- LAY-03 Targets are at least 24 × 24 px. Controls are 40 px high; the large size and touch-first surfaces use 44 px.
- LAY-04 Shadows only on floating overlays (menus, popovers, command palette, modal dialogs). Glow only for a live-data indicator or alongside the focus ring.
- LAY-05 Corners are 4 px; full radius only for badges, tags, counters and avatars; chart and strip marks use 0–1 px. Avatars (people) are circular; organization marks, icons and step indicators (system) use 4 px.
- LAY-06 A small size of 32 px is allowed for row actions in tables, segmented controls and filter chips. Forms and page actions keep 40 px, and every target stays at least 24 × 24 px (LAY-03).
- LAY-07 A modal dialog sits over a scrim (Canvas at 60% in dark, Text at 35% in light) and carries one shadow per theme: `0 24px 64px` at black 40% (dark) and at Text 16% (light).

## Components

**Principle.** Every pattern shows its real state and adds nothing the assigned flow does not need. One dominant action per group; destructive actions are marked by wording and consequence, not red alone. Tables keep clear headers, aligned values, visible sort and filter context, correct counts and ownership context on small screens.

- CMP-01 Feedback distinguishes loading, no data, no filter matches, restricted, failure, pending and success. Unknown or stale data never looks healthy, current or empty.
- CMP-02 Forms keep persistent labels, errors next to the field, input after failure, a visible pending state and no accidental duplicate submits.
- CMP-03 Overlays have a clear title, dismissal and return path; modals trap focus while open, restore it on close and fit the viewport.
- CMP-04 Collapsed navigation stays keyboard-usable, and closed items are unreachable.
- CMP-06 A designed element with no backing data yet (a mockup) renders in its real route inside a marked region (dashed strong edge): the notice "ตัวอย่าง · ยังไม่เชื่อมข้อมูลจริง", a link to its GitHub issue and an `aria-label` that names the region an example. Sample data inside is neutral and labelled and never looks like live telemetry (CMP-05): no status colors, live indicator or freshness claim.

## Accessibility

**Principle.** Everything works by keyboard with visible focus, logical order and meaningful names, and nothing relies on hover, placeholders or color alone. Motion is brief, respects reduced-motion and never hides essential content. Before accepting a design, review both themes on desktop, keyboard and focus, and the relevant error, empty and permission states. Narrow layouts and enlarged text follow LAY-02 in implementation and are checked only when a user reports a problem or asks for it.

- A11Y-01 The focus indicator stays visible against adjacent surfaces, including primary buttons, with an offset from the fill; a glow never replaces it.

## Evidence surfaces

Apply when a surface shows findings, severity, health, freshness or charts. Severity, health and freshness stay separate concepts, and no numeric risk threshold is invented. Charts reuse the status roles and label unrelated series directly instead of using a rainbow palette.

- COL-02 Critical and high share Danger with distinct labels and order; medium uses Caution; low, info, unknown and stale are neutral with explicit labels.
- CMP-05 Evidence labels chart units, timeframe, source and missing data with a non-color summary; demos never appear as live telemetry.
