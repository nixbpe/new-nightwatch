---
name: spec-driven-development
description: Creates specs before coding. Use when starting a new project, feature, or significant change with no spec yet; when drafting a PRD with objectives and scope; when requirements are unclear or only a vague idea; or when one requirement spans several independently testable capabilities and needs a capability map before specifying.
---

# Spec-Driven Development

## Overview

Write a structured specification before writing any code. The spec is the shared source of truth between you and the human engineer — it defines what we're building, why, and how we'll know it's done. Code without a spec is guessing.

## When to Use

- Starting a new project or feature
- Requirements are ambiguous or incomplete
- The change touches multiple files or modules
- You're about to make an architectural decision
- The task would take more than 30 minutes to implement

**When NOT to use:** Single-line fixes, typo corrections, or changes where requirements are unambiguous and self-contained.

## The Gated Workflow

Spec-driven development has four phases, preceded by a scope check (Phase 0) that activates only when one request bundles several independently testable capabilities. Do not advance to the next phase until the current one is validated.

Phases 2–4 below are lightweight summaries: `planning-and-task-breakdown` is the canonical source for Phase 2–3 mechanics, and `incremental-implementation`/`test-driven-development` for Phase 4.

```
SPECIFY ──→ PLAN ──→ TASKS ──→ IMPLEMENT
   │          │        │          │
   ▼          ▼        ▼          ▼
 Human      Human    Human      Human
 reviews    reviews  reviews    reviews
```

### Phase 0: Scope Check

Most requests describe one capability — if this one does, skip straight to Specify.

**Decompose first when** the requirement names distinct capabilities with their own consumers or data (e.g. identity, billing, notifications), acceptance criteria cluster into independently shippable groups, or one capability could be cut without rewriting the others.

**Propose a capability map before writing any spec** — small and reviewable, a module table plus a build order:

```markdown
| Module id | Responsibility | Depends on |
|---|---|---|
| identity | Accounts, sessions, SSO | — |
| billing | Plans, invoices, payments | identity |

Build order: identity → billing
```

Stable, kebab-case module ids chosen once; dependency arrows point one way (two modules needing each other are one module); interfaces live in the depended-on module's own spec. **Gated like every phase:** the human reviews boundaries, dependencies, and build order before any module spec is written. Then recurse Specify → Plan → Tasks → Implement per module, saving each spec alongside the approved map as `SPEC-<module-id>.md`.

### Phase 1: Specify

Start with a high-level vision. Ask the human clarifying questions until requirements are concrete.

**Surface assumptions immediately**, before writing any spec content:

```
ASSUMPTIONS I'M MAKING:
1. This is a web application (not native mobile)
2. The database is PostgreSQL (based on existing Prisma schema)
→ Correct me now or I'll proceed with these.
```

Don't silently fill in ambiguous requirements — the spec exists to surface misunderstandings *before* code gets written.

**Write a spec covering:** Objective (what and why, who's the user, what does success look like), Tech Stack, Commands (full executable commands, not just tool names), Project Structure, Code Style (one real snippet beats three paragraphs), Testing Strategy, Boundaries (Always do / Ask first / Never do), Success Criteria, and Open Questions. A fill-in template for all nine is in `SPEC-TEMPLATE.md`.

**Reframe vague instructions as success criteria:**

```
REQUIREMENT: "Make the dashboard faster"
REFRAMED: LCP < 2.5s on 4G; initial data load < 500ms; no layout shift (CLS < 0.1)
→ Are these the right targets?
```

### Phase 2: Plan

Identify the major components and dependencies, the build order, risks and mitigations, what can run in parallel, and verification checkpoints between phases.

> **Output convention:** save the plan to `tasks/plan.md` and the task list to the target `planning-and-task-breakdown` defines (default `tasks/todo.md`). Create `tasks/` if it doesn't exist.

The plan should be reviewable: the human can read it and say "yes" or "no, change X."

### Phase 3: Tasks

Break the plan into tasks that are each completable in one focused session, with explicit acceptance criteria, a verification step, dependency ordering (not perceived importance), and no task touching more than ~5 files.

```markdown
- [ ] Task: [Description]
  - Acceptance: [What must be true when done]
  - Verify: [Test command, build, manual check]
  - Files: [Which files will be touched]
```

### Phase 4: Implement

Execute tasks one at a time following `incremental-implementation` and `test-driven-development`. Use `context-engineering` to load only the relevant spec sections and source files at each step.

## Keeping the Spec Alive

The spec is a living document: update it when decisions or scope change (before implementing, not after), commit it alongside the code, and reference the relevant section from each PR.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "This is simple, I don't need a spec" | Simple tasks don't need *long* specs, but they still need acceptance criteria. A two-line spec is fine. |
| "I'll write the spec after I code it" | That's documentation, not specification. The spec's value is in forcing clarity *before* code. |
| "Requirements will change anyway" | That's why the spec is a living document. An outdated spec is still better than no spec. |
| "It's one big feature; splitting it is overhead" | A monolithic spec forces every downstream task to reason over the whole contract. A ten-line capability map is cheap. |
| "I'll decompose during planning" | By then the oversized spec already exists — module boundaries must be decided before it's written, not after. |

## Red Flags

- Starting to write code without any written requirements
- Implementing features not mentioned in any spec or task list
- Skipping the spec because "it's obvious what to build"
- One spec whose requirements span several independently testable capabilities
- Module boundaries decided implicitly during implementation because no capability map was approved up front

## Verification

- [ ] The spec covers every core area (Objective, Tech Stack, Commands, Project Structure, Code Style, Testing Strategy, Boundaries, Success Criteria, Open Questions)
- [ ] The human has reviewed and approved the spec
- [ ] Success criteria are specific and testable
- [ ] The spec is saved to a file in the repository
- [ ] If the request bundles several capabilities, a capability map was approved before any module spec was written
