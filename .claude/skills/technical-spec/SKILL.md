---
name: technical-spec
description: How the Technical Lead writes the Technical Spec for a Feature - contracts, design decisions and the Task outline - before implementation, and which architecture drivers a design decision touches. Use for every Feature, after its acceptance is frozen.
argument-hint: "<Feature, e.g. F-002>"
---

# Technical Spec

## What this is for

The Feature says what to build and how to know it is done. The Technical Spec says how it will be built: the contracts other work depends on, the design choices and the Tasks. The user approves it before any code is written, so surprises surface while they are cheap.

## Steps

1. Start from a Feature whose scope the user approved and whose acceptance is frozen (skill:`acceptance-freeze`). If its UI flow is unclear, ask agent:`ux-designer`.
2. Copy file:`docs/templates/spec.md` to `docs/features/<Feature>/spec.md`.
3. Fill in the contracts (API, data and RLS, jobs). Check the architecture drivers below for any new contract, table, queue or dependency.
4. Outline the Tasks per skill:`delivery-orchestration` and map every AC to a Task.
5. List open decisions, then ask the user to approve the spec. Do not dispatch before approval.

## Rules

- Link to the Feature's ACs instead of restating them. Repository conventions stay in their own documents.
- Keep it short: a contract or decision nobody depends on does not belong here.
- A later change to an approved contract goes back to the user before it is built.

## Architecture drivers

Check only the qualities a design decision touches, so small changes stay small. DB/RLS and security checks that the change requires are never optional. Weigh each touched driver against the requirements, constraints and principles already approved:

Weigh each touched driver against the requirements, constraints and principles already approved:

- **Runtime**: performance (response time/latency), scalability (load per window), availability (nines as permitted downtime) and disaster recovery (RTO/RPO).
- **Protection**: security (authentication, authorization, confidentiality in transit/at rest, OWASP), privacy (personal data/GDPR), audit (who, when, why, before/after values and erasure conflicts), and legal/compliance (AML, GDPR, digital-services taxation).
- **Operability**: monitoring (read-only health, metrics, alerts), management (topology, cache refresh, feature toggles), maintainability (owner and required knowledge), flexibility (change direction/cost), accessibility (W3C), and internationalization (cheap upfront, costly retrofit, including RTL).
