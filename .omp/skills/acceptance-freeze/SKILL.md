---
name: acceptance-freeze
description: Fix what "done" means for a Feature before implementation, and control any later change to it. Used by the Product Owner, the Technical Lead and the Code Reviewer.
---

# Acceptance Freeze

## What this is for

Before anyone writes code, the Product Owner and the Technical Lead agree on a numbered list of acceptance criteria and lock it. Reviewers then judge the work against that list only, so the target cannot move during review. A real new requirement is still possible, but it goes through a visible scope change instead of slipping in.

## The Acceptance matrix

agent:`product-owner` writes the matrix with only the categories the change touches:

- **Scope**: routes, APIs and user journeys in scope.
- **Authorization**: which actor may or may not do which operation on which target.
- **State**: loading, empty, success, denied, revoked and failure.
- **Concurrency**: races to handle and the accepted outcome.
- **Security**: data never disclosed, log redaction, fresh-auth boundary.
- **Accessibility**: focus, keyboard, dialog, zoom/reflow.
- **Verification**: the scenario or command that proves each item.
- **Out of scope**: known items deliberately excluded.

Number each criterion `AC-<NN>` under its Feature or Story.

## Freezing

When the Product Owner and the Technical Lead approve the matrix, set `acceptanceVersion: <Feature-id>-AC-<n>` and `status: frozen`. Frozen fixes the criteria only; it does not authorize starting work or releasing.

## After freeze

- A reviewer may point only at an AC the work misses, a violation of an already-approved architecture or security rule, or a non-blocking follow-up. A reviewer never adds a criterion.
- A genuinely new criterion is a scope change: proposed AC → the Technical Lead classifies it as blocker or follow-up → the Product Owner approves → `acceptanceVersion` bumps (e.g. `-AC-1` to `-AC-2`) → the affected work is replanned.
- No criterion changes silently.
