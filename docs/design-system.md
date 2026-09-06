# NightWatch Design Rules

## Overview

Design for calm, precise security operations: readable evidence, clear scope, obvious next actions. These are UX/UI rules, not an implementation inventory or a technology prescription.

- Use one visual language across operational and marketing surfaces. Operations prioritize scanning dense data; marketing uses more whitespace and a simpler narrative.
- Keep Organization and Project context visible. Distinguish observed results, incomplete data, and illustrative content.
- Prefer neutral surfaces with one emerald primary accent. Avoid neon, decorative gradients, excessive cards, and color used merely to fill space.

## Colors

Use the same semantic roles in both themes. Values below are opaque colors; they are not interchangeable foreground/background pairs.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#F7F8FA` | `#111315` | Page background |
| Surface | `#FFFFFF` | `#1B1E22` | Panels, fields, overlays |
| Text | `#171A1F` | `#F3F4F6` | Primary content |
| Secondary text | `#5B6470` | `#ADB5BF` | Supporting content, metadata |
| Control boundary | `#7B8490` | `#6B7582` | Essential field/control outlines, not every panel |
| Primary / positive | `#087A55` | `#3ECF8E` | Primary action, links, focus; positive status with a label |
| On primary | `#FFFFFF` | `#11251C` | Text on a solid primary button only |
| Caution | `#8A5A00` | `#F2BE5C` | Warning text/icons on Canvas or Surface |
| Danger | `#BE123C` | `#FB7185` | Critical/high severity and destructive-action text/icons on Canvas or Surface |

- Primary buttons use Primary + On primary. Status badges use a neutral Surface with colored text/icon; never put white text on bright dark-theme emerald or reuse these text colors as arbitrary badge fills.
- Critical/high share Danger but retain distinct labels and ordering; medium uses Caution; low/information/unknown/stale use neutral text with explicit labels. Severity, health and freshness remain distinct concepts.
- Use color with text, icons, position or line styles. Do not imply success from a green primary action or classify business risk through an invented numeric threshold.
- Charts reuse these roles for status; use direct labels and line/marker distinctions for unrelated series. Avoid adding a rainbow palette.
- Preserve hierarchy and state meaning across themes; respect the user's theme preference.
- Opaque pairs above were checked using WCAG contrast. Rounded minimums: text/status colors on Canvas/Surface **5.03:1**; On primary **5.35:1**; control boundaries **3.56:1**. Recheck actual combinations, states and any transparency; this is not a claim of whole-interface accessibility.

## Typography

- Use a readable sans-serif with compatible Thai and Latin forms; prefer Inter for Latin and Noto Sans Thai for Thai. Use monospace only for identifiers or code, not all labels.
- Body and data: **14–16 px**, supporting labels: **12–14 px**, section/page headings: **20–28 px**; marketing display may reach **36–56 px**. Do not shrink essential content to fit a layout.
- Use regular body text and medium/semibold emphasis; comfortable line height around **1.5**, allowing Thai marks without clipping. Keep casing natural.
- Align numeric columns; show units, timezone and measurement window where needed. Never sacrifice legibility for density.

## Layout

- Use a **4 px** spacing rhythm: **8 / 16 / 24 / 32 px** for related controls, groups, panels and sections. Group by purpose before adding a container.
- Keep a clear page title, scope and one dominant next action. Navigation remains understandable without hover; active location needs more than color.
- Reflow to narrow screens and **200% text enlargement** without losing actions or labels. Contain necessary two-dimensional table scrolling; avoid whole-page horizontal scrolling.
- Controls need usable targets: at least **24 × 24 px** or equivalent spacing; prefer **44 × 44 px** for touch. Offer density without tiny text or targets.
- Show depth through Canvas/Surface and spacing. Reserve restrained shadows for floating overlays; no glow as a hierarchy device.
- Use **6 px** corners for controls and **12 px** for panels/overlays; pills only for compact tags.

## Components

| Pattern | UX rule |
| --- | --- |
| Actions | One visually dominant action per group; secondary actions stay quiet. Distinguish destructive actions by wording and consequence, not red alone. |
| Forms | Persistent labels, examples only when helpful, errors next to the relevant field. Retain input on failure; expose pending state and prevent accidental duplicate actions. |
| Tables | Clear headers, aligned values, visible sort/filter context, correct count meaning. Preserve ownership/context and access to important data on small screens. |
| Navigation | Stable labels and current location. Collapsed navigation remains keyboard-accessible and understandable; closed items must not remain reachable. |
| Overlays | Clear title, dismissal and return path. Modal interactions keep focus inside while open and restore it on close; content and actions fit the viewport. |
| Feedback | Distinguish loading, no data, no filter matches, restricted access, failure, pending and success. Unknown/stale data must not look healthy, current or empty. |
| Evidence | Label chart units, timeframe, source and missing data; provide a readable non-color summary. Do not present demonstrations as live telemetry. |

Apply only states and interactions relevant to the assigned flow; a pattern is not permission to add features.

## Do's and Don'ts

- Support keyboard operation with visible focus, a logical order and meaningful control names. Never rely on hover, placeholder text or color alone.
- Keep normal text contrast ≥ **4.5:1**, essential control/focus distinctions ≥ **3:1**. A focus indicator must remain visible against adjacent surfaces, including primary buttons; separate it from the button fill.
- Keep motion brief and purposeful; respect reduced-motion preferences and never require animation to reveal essential content.
- Before accepting a design, review both themes, narrow layouts, enlarged text, keyboard/focus and relevant error/empty/permission states. Palette math alone does not prove those behaviors.
- Do not prescribe libraries, markup, storage, build tooling or deployment here. Do not claim a design is implemented merely because it is documented.

References: [Google DESIGN.md outline](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md); [Supabase-inspired palette](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/supabase/DESIGN.md) for restrained emerald; [Linear-inspired hierarchy](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md) for neutral surfaces. The latter two are community analyses, not official brand standards; NightWatch's light/dark pairs above are adapted and checked independently.
