---
name: security-and-hardening
description: Hardens code against vulnerabilities. Use when auditing an input handler for vulnerabilities, when handling user input, authentication, data storage, or external integrations, or when checking a login flow is safe against the OWASP Top Ten. Use when building any feature that accepts untrusted data, manages user sessions, or interacts with third-party services. Use when auditing dependencies for known vulnerabilities, triaging package-manager audit findings, or assessing supply-chain risk in a new package. Use when personal data or privacy compliance (GDPR, CCPA) is involved.
---

# Security and Hardening

## Overview

Security-first development practices for web applications. Treat every external input as hostile, every secret as sacred, and every authorization check as mandatory. Security is a constraint on every line of code that touches user data, authentication, or external systems.

## When to Use

- Building anything that accepts user input
- Implementing authentication or authorization
- Storing or transmitting sensitive data
- Integrating with external APIs or services
- Adding file uploads, webhooks, or callbacks
- Handling payment or PII data

## Process: Threat Model First

Controls added without a threat model are guesses. Before hardening, spend five minutes thinking like an attacker:

1. **Map the trust boundaries.** Where does untrusted data cross into your system? HTTP requests, form fields, file uploads, webhooks, third-party APIs, message queues, and **LLM output**, plus local values that look internal: another process's command line or environment, filenames on a shared volume, a path in a job payload. Trust follows who *wrote* a value, not which channel delivered it.
2. **Name the assets.** What's worth stealing or breaking? Credentials, PII, payment data, admin actions, money movement.
3. **Run STRIDE over each boundary:**

| Threat | Ask | Typical mitigation |
|---|---|---|
| **S**poofing | Can someone impersonate a user/service? | Authentication, signature verification |
| **T**ampering | Can data be altered in transit or at rest? | Integrity checks, parameterized queries, HTTPS |
| **R**epudiation | Can an action be denied later? | Audit logging of security events |
| **I**nformation disclosure | Can data leak? | Encryption, field allowlists, generic errors |
| **D**enial of service | Can it be overwhelmed? | Rate limiting, input size caps, timeouts |
| **E**levation of privilege | Can a user gain rights they shouldn't? | Authorization checks, least privilege |

4. **Write abuse cases next to use cases.** For each feature, ask "how would I misuse this?" and make that your first test.

If you can't name the trust boundaries for a feature, you're not ready to secure it (OWASP **A04: Insecure Design**).

## The Three-Tier Boundary System

### Always Do (No Exceptions)

- **Validate all external input** at the system boundary (API routes, form handlers)
- **Parameterize all database queries**, never concatenate user input into SQL
- **Encode output** to prevent XSS (use framework auto-escaping, don't bypass it)
- **Use HTTPS** for all external communication
- Keep password handling inside the existing authentication library
- **Set security headers** (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- **Use httpOnly, secure, sameSite cookies** for sessions
- **Run the detected package manager's native audit** against the committed lockfile before every release

### Ask First (Requires Human Approval)

- Adding new authentication flows or changing auth logic
- Storing new categories of sensitive data (PII, payment info)
- Adding new external service integrations
- Changing CORS configuration
- Adding file upload handlers
- Modifying rate limiting or throttling
- Granting elevated permissions or roles

### Never Do

- **Never commit secrets** to version control (API keys, passwords, tokens)
- **Never log sensitive data** (passwords, tokens, full credit card numbers)
- **Never trust client-side validation** as a security boundary
- **Never use `eval()` or `innerHTML`** with user-provided data
- **Never store sessions in client-accessible storage** (e.g. auth tokens in localStorage)
- **Never expose stack traces** or internal error details

## OWASP Top 10 Prevention Patterns

These are prevention patterns, not a ranking. For the OWASP 2021 ordering, use file:`../../references/security-checklist.md`.

### Injection (SQL, NoSQL, OS Command)

Bind query values and constrain command arguments at the boundary. Apply DB-02 in file:`../../../docs/architecture.md`.

### Broken Authentication

Use the existing authentication library and its session policy in file:`../../../docs/ref/authentication.md`. Do not introduce a separate password or session implementation from a generic example.

### Cross-Site Scripting (XSS)

Use framework output escaping. Treat raw HTML as an untrusted boundary requiring an approved sanitizer; do not bypass escaping for user-controlled content.

### Broken Access Control

Check the current actor's membership and operation permission before protected data lookup. Apply the request and isolation rules in file:`../../../docs/architecture.md`.

### Security Misconfiguration

Review the actual application headers, trusted origins and credentialed CORS configuration. Cookie and origin rules are AUTH-02 and AUTH-03 in file:`../../../docs/architecture.md`.

### Sensitive Data Exposure

Check response field allowlists and log redaction against the approved contract. Secrets come from the existing environment interface, never from a fallback literal.

### Server-Side Request Forgery (SSRF)

Use the shared outbound helper required by OUT-01 in file:`../../../docs/architecture.md`. Verify DNS, redirect and connection-time behavior together; validation followed by a separate DNS lookup leaves a rebinding gap.

## Input Validation Patterns

### Schema Validation at Boundaries

Apply REQ-02 and REQ-05 in file:`../../../docs/architecture.md`. Use the shared boundary schema and standard error envelope; generic framework validation examples do not define the response contract.

### File Upload Safety

When uploads are in scope, check the approved type and size limits and validate content rather than trusting extensions or client metadata.

### Destructive Operations on Derived Paths

A delete, move, or overwrite is only as safe as the value that names its target. Reading that value from the kernel, a job payload, or a sibling service proves where it *arrived from*, not who *wrote* it. A shape check ("absolute path, at least one directory deep") proves well-formedness and gets mistaken for authorization; that is how a cleanup routine deletes the root instead of the leaf.

Before a destructive call, require all three: the resolved target sits under an **allowlisted root** (compare after resolving symlinks, never on the raw string); it is at least one level **below** that root, so a root is never itself the target; and it carries **evidence that it is yours**, read *before* the operation and before any teardown that removes it — otherwise "absent" and "not mine" are indistinguishable. On refusal, log the rejected target and stop: a cleanup that falls back to a broader default path is the failure this guards against. Worked example in `../../references/security-checklist.md`.

Two limits of this check. A marker inside the tree is self-attestation — anything that can write there can write the marker — so the expected owner has to come from authenticated state, and the marker needs integrity protection (restrictive ownership, or a MAC) before it counts as authorization. And resolving a path and then operating on the *name* is a check/use race wherever an untrusted process can swap an ancestor: on a shared volume, hold the target by descriptor and use no-follow, beneath-the-root operations, or make sure the hierarchy cannot change for the duration.

## Triaging Dependency Audit Results

Package-manager audits report known advisories; they do not prove a package is trustworthy or that vulnerable code is reachable. Decision tree:

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

**Key questions:**
- Is the vulnerable function actually called in your code path?
- Is the dependency a runtime dependency or dev-only?
- Is the vulnerability exploitable given your deployment context (e.g., a server-side vulnerability in a client-only app)?

When you defer a fix, document the reason and set a review date.

### Supply-Chain Hygiene

Do not assume npm or treat the nearest manifest as the install root. Apply this order:

1. **Find the installation boundary and manager.** Use the workspace root that owns the lockfile, or an independent nested project only when it is outside that workspace. There, corroborate `packageManager` (when present), the lockfile and CI; stop on disagreement or competing lockfiles. Pin the manager version and use file:`../../references/security-checklist.md`.
2. **Block dependency scripts before first execution.** Bootstrap with scripts disabled or a documented fail-closed policy, inspect the pending script source, approve only the minimum required packages, commit the policy, then verify with a clean frozen/immutable install. Never blanket-approve scripts.

Audits do not catch a newly malicious or typosquatted package. Therefore:

- **Never apply forced audit remediation automatically** (`npm audit fix --force` or equivalent). Preview the remediation, read changelogs, and test each resulting upgrade; forced fixes may cross declared dependency ranges.
- **Verify registry signatures and provenance where supported** (`npm audit signatures`, `pnpm audit signatures`) and treat absence as a signal to investigate.
- **Review new dependencies, lockfile diffs, and script-policy changes together:** ownership, maintenance, release age, provenance, transitive graph, and typosquats such as `cross-env` vs `crossenv` (OWASP **A06**, **LLM03**).
- **Before adding a dependency,** check whether the existing stack solves it, its size and maintenance, its known vulnerabilities and its license.
- **Upgrade one dependency per change:** read the changelog for behavioral changes, let a green suite before and after decide, review the lockfile diff including transitive changes, and never hand-edit the lockfile.

## Rate Limiting

Check the existing shared-store limiter and its failure behavior. Application limiting follows REQ-04 in file:`../../../docs/architecture.md`; auth throttling remains a separate boundary.

## Secrets Management

Use the repository's secrets gate in file:`../../../scripts/quality/README.md` and check staged scope before commit. A keyword grep is not a replacement for the scanner.

If a secret was committed, treat it as compromised. Rotate or revoke it through an authorized owner before any history cleanup.

## Data Privacy & Compliance

For collection, retention, deletion, export, residency or third-party sharing of personal data, read the Data Privacy & Compliance section in file:`../../references/security-special-cases.md`.

## Securing AI / LLM Features

When the change adds an LLM call, retrieval or model-driven action, read the Securing AI / LLM Features section in file:`../../references/security-special-cases.md`.

## See Also

For detailed security checklists and pre-commit verification steps, use file:`../../references/security-checklist.md`.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "This is an internal tool, security doesn't matter" | Internal tools get compromised. |
| "We'll add security later" | Security retrofitting is 10x harder than building it in. Add it now. |
| "No one would try to exploit this" | Automated scanners will find it. |
| "The framework handles security" | Frameworks provide tools, not guarantees. You still need to use them correctly. |
| "It's just a prototype" | Prototypes become production. Security habits from day one. |
| "It's just LLM output, it's only text" | That text can be a SQL statement, a script tag, or a shell command. |
| "The audit passed, so the dependency is safe" | Audits match known advisories. They do not detect a newly malicious package or make unreviewed install scripts safe to execute. |
| "Collect it now, we might need it later" | Data you don't hold can't be breached. "Might need it" is breach scope, not a purpose. |
| "We'll handle deletion requests manually" | Manual erasure misses backups, caches, and analytics copies. If the schema can't find a user's data, you can't honor the request. |
| "Compliance is legal's problem, not ours" | Export, deletion, retention, and consent are schema and code. |

## Red Flags

- User input passed directly to database queries, shell commands, or HTML rendering
- A delete, move, or overwrite whose target comes from a payload, a config value, or another process's command line, guarded only by a shape check on the path
- API endpoints without authentication or authorization checks
- Missing CORS configuration or wildcard (`*`) origins
- No rate limiting on authentication endpoints, or an in-memory limiter in front of more than one instance
- Dependencies with known critical vulnerabilities, competing lockfiles at one installation boundary, non-reproducible installs, or blanket-approved scripts
- Server fetches user-supplied URLs without an allowlist (SSRF)
- LLM/model output passed into a query, the DOM, a shell, or `eval`
- Secrets, PII, or the full system prompt inside an LLM context window
- Personal data collected with no stated purpose, retention limit, or deletion path
- PII sent to analytics/ad/LLM vendors with no consent or data-processing agreement
- "Delete my account" that only flips a flag while personal data remains in stores and backups

## Verification

After implementing security-relevant code:

- [ ] The native audit has no unmitigated reachable critical/high findings; CI preserves the authoritative lockfile and blocks unreviewed dependency scripts
- [ ] No secrets in source code or git history
- [ ] All user input validated at system boundaries
- [ ] Destructive filesystem operations resolve symlinks, then verify allowlisted root, minimum depth, and ownership before running
- [ ] Authentication and authorization checked on every protected endpoint
- [ ] Security headers present in response (check with browser DevTools)
- [ ] Error responses don't expose internal details
- [ ] Rate limiting active on auth endpoints, backed by a shared store when more than one instance serves traffic
- [ ] Server-side URL fetches validated against an allowlist (no SSRF)
- [ ] LLM/model output validated and encoded before use (if AI features present)
- [ ] Personal data is classified, minimized to a stated purpose, and has a retention limit
- [ ] Deletion and export requests work end-to-end (including backups, caches, and analytics copies)
