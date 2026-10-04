---
name: security-and-hardening
description: Threat-model and harden untrusted input, authentication, authorization, sensitive data, external services, dependencies, and LLM boundaries.
---

# Security and Hardening

## Overview

Follow accepted scope, repository security contracts, and role permissions. Read file:`../../../docs/architecture.md` for the named request, authentication, isolation, and outbound rules below. Use file:`../../references/security-checklist.md` for detailed checks and OWASP 2021 ordering.

## Process: Threat Model First

Before adding controls:

1. Map trust boundaries, including requests, uploads, webhooks, APIs, queues, LLM output, process arguments, environments, shared filenames, and job paths. Trust depends on who wrote a value, not its delivery channel.
2. Name assets such as credentials, PII, payment data, admin actions, and money movement.
3. Apply STRIDE to each boundary: spoofing, tampering, repudiation, information disclosure, denial of service, and elevation of privilege.
4. Write abuse cases beside use cases and test them first.

Missing trust boundaries leave the design unready for hardening, as OWASP A04: Insecure Design describes.

## The Three-Tier Boundary System

### Always Do (No Exceptions)

Apply these controls to every relevant boundary:

- Validate external input, parameterize database queries, and encode output with framework escaping.
- Use HTTPS for external communication and the existing authentication library for passwords.
- Set CSP, HSTS, X-Frame-Options, and X-Content-Type-Options. Use httpOnly, secure, sameSite session cookies.
- Run the detected package manager's native audit against the committed lockfile before every release.

### Ask First (Requires Human Approval)

Require approval before new authentication flows, auth changes, sensitive-data categories, external integrations, CORS changes, uploads, rate-limit changes, or elevated roles and permissions.

### Never Do

Never commit secrets, log credentials or full payment details, expose stack traces or internal error details, use client validation as a security boundary, or store sessions in client-accessible storage. Never pass user-controlled data into `eval()` or `innerHTML`.

## OWASP Top 10 Prevention Patterns

Apply the repository's named controls:

### Injection (SQL, NoSQL, OS Command)

Bind query values and constrain command arguments at the boundary. Apply DB-02.

### Broken Authentication

Use the existing auth library and session policy in file:`../../../docs/ref/authentication.md`. Never add a separate password or session implementation from an example.

### Cross-Site Scripting (XSS)

Keep framework escaping. Raw HTML needs an approved sanitizer at its untrusted boundary.

### Broken Access Control

Check current membership and operation permission before protected lookup. Preserve request and tenant isolation rules.

### Security Misconfiguration

Check actual headers, trusted origins, credentialed CORS, and AUTH-02 and AUTH-03 cookie and origin rules.

### Sensitive Data Exposure

Check response allowlists and log redaction. Read secrets through the existing environment interface, never a fallback literal.

### Server-Side Request Forgery (SSRF)

Use the shared outbound helper required by OUT-01. Verify DNS, redirects, and connection-time behavior together. Separate validation and DNS lookup leave a rebinding gap.

## Input Validation Patterns

### Schema Validation at Boundaries

Apply REQ-02 and REQ-05 with the shared schema and standard error envelope. Framework examples never redefine the response contract.

### File Upload Safety

Enforce approved types and size limits. Validate content instead of trusting extensions or client metadata.

### Destructive Operations on Derived Paths

Before delete, move, or overwrite, resolve symlinks and require all three conditions:

- The target is under an allowlisted root.
- The target is at least one level below that root, never the root itself.
- Ownership evidence identifies the target as task-owned. Read it before the operation and before teardown destroys it.

If any condition fails, log the rejected target and stop. Never fall back to a broader path. Shape or delivery channel does not prove authorization.

A marker is self-attestation. Require an expected owner from authenticated state and restrictive ownership or a MAC protecting the marker. On mutable shared hierarchies, prevent check/use races with descriptor-held, no-follow, beneath-root operations, or keep the hierarchy unchanged throughout the operation. The security checklist has a worked example.

## Triaging Dependency Audit Results

Use reachability across runtime, build, test, and deployment paths. A clean audit does not prove package trust or unreachable vulnerable code.

```
The native package-manager audit reports a vulnerability
├── Severity: critical or high
│   ├── Is the vulnerable code reachable in runtime, build, test, or deployment paths?
│   │   ├── YES --> Fix immediately (update, patch, or replace the dependency)
│   │   └── NO (confirmed unused across those paths) --> Fix soon, but not a blocker
│   └── Is a fix available?
│       ├── YES --> Update to the patched version
│       └── NO --> Check for workarounds, consider replacing the dependency, or add to allowlist with a review date
├── Severity: moderate
│   ├── Reachable in production? --> Fix in the next release cycle
│   └── Dev-only? --> Fix when convenient, track in backlog
└── Severity: low
    └── Track and fix during regular dependency updates
```

Document the affected function, deployment context, deferral reason, and review date. Runtime versus dev-only classification alone does not prove reachability.

### Supply-Chain Hygiene

1. Find the install boundary that owns the lockfile. Treat a nested project independently only outside the workspace. Corroborate `packageManager`, lockfile, and CI; stop on disagreement or competing lockfiles. Pin the manager version.
2. Before first execution, disable dependency scripts or use a documented fail-closed policy. Inspect pending scripts, approve minimum required packages, commit the policy, and verify a clean frozen or immutable install. Never blanket-approve scripts.
3. Never force audit remediation automatically, including `npm audit fix --force`. Preview changes, read changelogs, and test upgrades.
4. Where supported, verify signatures and provenance with `npm audit signatures` or `pnpm audit signatures`. Investigate absence.
5. Review dependencies, lockfile, and script-policy changes together for ownership, maintenance, release age, provenance, transitive graph, license, size, and typosquats such as `cross-env` versus `crossenv`. Apply OWASP A06 and LLM03. Prefer the existing stack before adding a package.
6. Upgrade one dependency per change. Check behavior before and after, including transitive lockfile changes. Never hand-edit the lockfile.

## Rate Limiting

Check the shared-store limiter and its failure behavior under REQ-04. Keep auth throttling a separate boundary; multi-instance traffic requires shared state.

## Secrets Management

Use the repository's secrets gate in file:`../../../scripts/quality/README.md` and inspect staged scope. Keyword grep never replaces the scanner.

Treat a committed secret as compromised. Have an authorized owner rotate or revoke it before history cleanup.

## Data Privacy & Compliance

For collection, retention, deletion, export, residency, or third-party sharing, read Data Privacy & Compliance in file:`../../references/security-special-cases.md`. Require classified and purpose-limited data, consent, retention, and working export and deletion across backups, caches, indexes, and analytics.

## Securing AI / LLM Features

For LLM calls, retrieval, or model-driven actions, read Securing AI / LLM Features in the special-cases reference above. Validate and encode output, isolate tenant retrieval, protect prompt secrets, constrain tools and destructive actions, and bound consumption. Prompts do not replace enforcement in code.

## See Also

Use the security checklist for detailed verification instead of copying its full contents here.

## Verification

Report executed checks and gaps within the assigned scope. Require boundary validation, protected-endpoint authorization, headers and generic errors, shared auth limiting, outbound allowlists, safe destructive paths, and no secret exposure.

Require no unmitigated reachable critical or high audit findings, preserved authoritative lockfiles, and blocked unreviewed scripts. For personal data or AI changes, include the applicable special-case controls. Never report clean scanners as proof of all runtime security.
