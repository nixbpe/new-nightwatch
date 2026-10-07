---
name: technical-spec
description: Define shared technical contracts and bounded Tasks when a request needs a design. Keep the code index free of behavior rules and preserve accepted scope.
argument-hint: "<Feature or issue>"
---

# Technical Spec

## What this is for

Resolve cross-cutting contracts or a requested design. Routine work with settled criteria can use the request or issue directly.

## Steps

1. Use the request or issue as the source. Identify touched contracts and unresolved decisions.
2. Define only changed API, data/RLS, job, Web, authorization and concurrency contracts. Read their owning repository references.
3. Record detailed design and verification in the assigned issue or handoff. Update only capability names and source-file links in file:`docs/features.md`, following file:`docs/templates/feature.md`. Do not create separate Feature or spec files.
4. When implementation is requested, name owned Tasks, prerequisites and focused proof. Map source requirements to verification.
5. Ask for decisions that change scope or accepted contracts. An explicit implementation request supplies start authorization; design-only approval does not authorize implementation or release.

## Rules

Link source criteria instead of copying them. Keep repository conventions in their owning references. Include only decisions other work depends on.

## Acceptance freeze

Preserve accepted criteria and existing IDs or `acceptanceVersion` when the assignment uses them. Historical matrices remain available in Git. New work does not require a separate matrix or version ceremony.

- Review findings cite a missed source requirement, an existing architecture or security rule, or a non-blocking follow-up. Reviewers never add criteria.
- Obtain user approval for changed scope or accepted contracts and record that decision at the source. Never change criteria silently.
- Approval does not authorize publication, deployment or release.

## Architecture drivers

Check only touched qualities against the source requirements. Required DB/RLS and security checks are never optional. Define race outcomes, disclosure limits, log redaction and fresh-auth boundaries where affected. Do not invent latency, availability or recovery targets.
