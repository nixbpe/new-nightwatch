---
name: technical-spec
description: Write a Feature's technical contracts and Tasks after scope approval. User approval of the spec freezes acceptance but does not start implementation.
argument-hint: "<Feature, e.g. F-002>"
---

# Technical Spec

## What this is for

Turn approved Feature requirements into contracts, design decisions, and Tasks. The approved spec governs implementation and review through `VERIFY`, `PROOF`, `Covers`, and mapped `AC-<NN>` rows.

## Steps

1. Require user-approved Feature scope and a `draft` Acceptance matrix with behavior rows. Resolve unclear UI behavior with its assigned owner.
2. Copy file:`docs/templates/spec.md` to `docs/features/<Feature>/spec.md`.
3. Define API, data and RLS, job, and other touched contracts. Check Architecture drivers below and add applicable technical acceptance rows.
4. Outline owned Tasks and dependencies. Map every AC to a Task or integrated verification.
5. Record open decisions and request user approval. Freeze acceptance on approval. Do not dispatch without separate start authorization.

## Rules

Link to Feature ACs instead of restating them. Keep repository conventions in their owning documents. Include only contracts or decisions other work depends on.

## Acceptance freeze

Keep criteria in the Feature's Acceptance matrix, using `AC-01`, `AC-02` across the Feature. Use file:`docs/templates/feature.md` for its structure.

The requirements writer supplies `draft` behavior rows. During spec drafting, add only touched technical categories:

- Concurrency, with races and accepted outcomes.
- Security, with disclosure limits, log redaction, and fresh-auth boundaries.
- Verification, with a scenario or command proving each item.

On user approval, set `acceptanceVersion: <Feature-id>-AC-<n>` and `status: frozen`. Record the approval date in the spec. Before approval, criteria can change without a version bump. Freeze never authorizes release.

After freeze:

- Review findings must name a missed AC, an already-approved architecture or security rule, or a non-blocking follow-up. Reviewers never add criteria.
- For a new criterion, obtain a proposed AC from the requirements owner and blocker or follow-up classification from the technical coordinator. Require user approval, bump `acceptanceVersion` from `-AC-1` to `-AC-2`, update Revisions, re-approve the spec, and replan affected work.
- Return approved contract changes to the user before implementation and record them under Revisions.
- Never change criteria silently.

## Architecture drivers

Check only touched qualities against approved requirements and constraints. Required DB/RLS and security checks are never optional.

- Runtime: latency, load per window, availability as permitted downtime, and disaster recovery with RTO/RPO.
- Protection: authentication, authorization, encryption, OWASP, privacy and GDPR, audit identity and before/after values, erasure conflicts, and applicable AML or digital-services taxation rules.
- Operability: read-only health, metrics, alerts, topology, cache refresh, feature toggles, maintenance ownership, flexibility, W3C accessibility, internationalization, and RTL.
