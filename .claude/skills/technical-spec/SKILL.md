---
name: technical-spec
description: How the Technical Lead writes the Technical Spec for a Feature - contracts, design decisions and the Task outline - before implementation, and which architecture drivers a design decision touches. Use for every Feature, after the user approves its scope; the spec's approval freezes its acceptance.
argument-hint: "<Feature, e.g. F-002>"
---

# Technical Spec

## What this is for

The Feature says what to build and how to know it is done. The Technical Spec says how: the contracts other work depends on, the design choices and the Tasks. The user approves it before any code is written, so surprises surface while cheap.

The approved spec is the source of truth for implementation and review. Workers build to its contracts and Tasks (`VERIFY`, `PROOF`, `Covers`); reviewers judge against them and the `AC-<NN>` rows they map to. Approval freezes those criteria (see Acceptance freeze below).

## Steps

1. Start from a Feature whose scope the user approved and whose Acceptance matrix is `draft` with the Product Owner's behavior rows. If its UI flow is unclear, ask agent:`ux-designer`.
2. Copy file:`docs/templates/spec.md` to `docs/features/<Feature>/spec.md`.
3. Fill in the contracts (API, data and RLS, jobs). Check the architecture drivers below for any new contract, table, queue or dependency. Add the technical rows to the Feature's Acceptance matrix (see Acceptance freeze).
4. Outline the Tasks per skill:`delivery-orchestration` and map every AC to a Task.
5. List open decisions, then ask the user to approve the spec. Do not dispatch before approval. On approval, freeze acceptance (see below).

## Rules

- Link to the Feature's ACs instead of restating them. Repository conventions stay in their own documents.
- Keep it short: a contract or decision nobody depends on does not belong here.

## Acceptance freeze

Acceptance criteria are numbered `AC-01`, `AC-02`… across the whole Feature and live in the Acceptance matrix of the Feature file (file:`docs/templates/feature.md`). The Product Owner writes the behavior rows as `draft`. While drafting the spec, the Technical Lead adds only the technical categories the change touches:

- **Concurrency**: races to handle and the accepted outcome.
- **Security**: data never disclosed, log redaction, fresh-auth boundary.
- **Verification**: the scenario or command that proves each item.

When the user approves the spec, set `acceptanceVersion: <Feature-id>-AC-<n>` and `status: frozen` in the Feature file, and record the approval date in the spec. Frozen fixes the criteria only; it does not authorize a release. Before approval, criteria change freely without a version bump.

After freeze:

- A reviewer may point only at an AC the work misses, a violation of an already-approved architecture or security rule, or a non-blocking follow-up. A reviewer never adds a criterion.
- A genuinely new criterion is a scope change: proposed AC from the Product Owner → the Technical Lead classifies it as blocker or follow-up → the user approves → `acceptanceVersion` bumps (e.g. `-AC-1` to `-AC-2`), the spec is updated and re-approved, and the affected work is replanned.
- A change to an approved contract goes back to the user before it is built.
- No criterion changes silently.

## Architecture drivers

Check only the qualities a design decision touches. DB/RLS and security checks that the change requires are never optional. Weigh each touched driver against the requirements, constraints and principles already approved:

- **Runtime**: performance (response time/latency), scalability (load per window), availability (nines as permitted downtime) and disaster recovery (RTO/RPO).
- **Protection**: security (authentication, authorization, confidentiality in transit/at rest, OWASP), privacy (personal data/GDPR), audit (who, when, why, before/after values and erasure conflicts), and legal/compliance (AML, GDPR, digital-services taxation).
- **Operability**: monitoring (read-only health, metrics, alerts), management (topology, cache refresh, feature toggles), maintainability (owner and required knowledge), flexibility (change direction/cost), accessibility (W3C), and internationalization (cheap upfront, costly retrofit, including RTL).
