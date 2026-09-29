---
name: technical-spec
description: How the Technical Lead writes the Technical Spec for a Feature - contracts, design decisions and the Task outline - before implementation. Use for every Feature, after its acceptance is frozen.
---

# Technical Spec

## What this is for

The Feature says what to build and how to know it is done. The Technical Spec says how it will be built: the contracts other work depends on, the design choices and the Tasks. The user approves it before any code is written, so surprises surface while they are cheap.

## Steps

1. Start from a Feature whose scope the user approved and whose acceptance is frozen (skill:`acceptance-freeze`). If its UI flow is unclear, ask agent:`ux-designer`.
2. Copy file:`docs/templates/spec.md` to `docs/features/<Feature>/spec.md`.
3. Fill in the contracts (API, data and RLS, jobs). Use skill:`architecture-drivers` for any new contract, table, queue or dependency.
4. Outline the Tasks per skill:`delivery-orchestration` and map every AC to a Task.
5. List open decisions, then ask the user to approve the spec. Do not dispatch before approval.

## Rules

- Link to the Feature's ACs instead of restating them. Repository conventions stay in their own documents.
- Keep it short: a contract or decision nobody depends on does not belong here.
- A later change to an approved contract goes back to the user before it is built.
