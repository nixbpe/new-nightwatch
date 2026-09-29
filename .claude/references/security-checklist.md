# Security Checklist

Quick reference for web security. Use with skill:`security-and-hardening`.

## Threat Modeling (Start Here)

- [ ] Trust boundaries mapped (requests, uploads, webhooks, third-party APIs, and local values written by processes you don't control)
- [ ] Assets named (credentials, personal data, admin actions)
- [ ] STRIDE run per boundary (Spoofing, Tampering, Repudiation, Info disclosure, DoS, Elevation)
- [ ] Abuse cases written next to use cases ("how would I misuse this?")

## Pre-Commit Checks

- [ ] `bun run security:secrets` passes; no secrets in code
- [ ] `.gitignore` covers `.env*` files with real values, `*.pem` and `*.key`
- [ ] `.env.example` holds placeholders only

## Authentication

- [ ] Session cookies are `httpOnly`, `secure` and `sameSite: 'lax'`, with a reasonable max-age
- [ ] Login and recovery endpoints are rate limited
- [ ] Password reset and invitation tokens are time-limited and single-use
- [ ] MFA available for sensitive operations

## Authorization

- [ ] Every protected endpoint checks authentication
- [ ] Every resource access checks ownership, role and organization (prevents IDOR)
- [ ] Admin operations check the admin role per operation

## Input Validation

- [ ] All input validated at system boundaries with allowlists, length limits and numeric ranges
- [ ] Email, URL and date formats validated with proper libraries
- [ ] File uploads restricted by type and size, with content checked
- [ ] SQL parameterized; HTML output auto-escaped
- [ ] Redirect targets validated (no open redirect)
- [ ] Server-side fetches allowlisted, with private and reserved IPs blocked (no SSRF)
- [ ] Destructive path operations resolve symlinks first, stay under an allowlisted root with a minimum depth, and read ownership evidence before the call

## Security Headers

```
Content-Security-Policy: default-src 'self'; script-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0  (disabled, rely on CSP)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## CORS and Errors

- [ ] Credentialed CORS allows an exact origin list; never `*`
- [ ] Production errors return a generic message in the standard error envelope, never stack traces, SQL or raw validation details

## Data Protection

- [ ] Sensitive fields excluded from API responses (password hashes, reset tokens)
- [ ] Passwords, tokens and personal data never logged
- [ ] Personal data and credentials encrypted at rest where required
- [ ] HTTPS for all external communication; backups encrypted

## Dependency Security

- [ ] Installs use the committed lockfile (`bun install --frozen-lockfile`), and CI never rewrites it
- [ ] `bun run security:audit` passes; critical/high findings are triaged for reachability, and deferrals have a reason and review date
- [ ] Dependency lifecycle scripts run only for reviewed packages listed in `trustedDependencies`
- [ ] Forced audit fixes are never automatic; remediation diffs and changelogs are reviewed
- [ ] New dependencies are reviewed for ownership, maintenance, release age, provenance, transitive graph and typosquatting

## Privacy

- [ ] Personal data is classified, collected for a stated purpose and minimized
- [ ] Personal data has a retention limit and a working deletion path, including backups and indexes
- [ ] Data-subject export and deletion requests are supported where required; sharing with third parties has consent

## AI / LLM (if used)

- [ ] Model output is treated as untrusted (no eval, SQL, innerHTML or shell)
- [ ] Secrets and other users' data are kept out of prompts
- [ ] Tool and agent permissions are scoped; destructive actions require confirmation

## OWASP Top 10 Quick Reference

| # | Vulnerability | Prevention |
|---|---|---|
| 1 | Broken Access Control | Auth checks on every endpoint, ownership verification |
| 2 | Cryptographic Failures | HTTPS, strong hashing, no secrets in code |
| 3 | Injection | Parameterized queries, input validation |
| 4 | Insecure Design | Threat modeling, a technical spec before building |
| 5 | Security Misconfiguration | Security headers, minimal permissions, audit deps |
| 6 | Vulnerable Components | Dependency audit, keep deps updated, minimal deps |
| 7 | Auth Failures | Rate limiting, session management |
| 8 | Data Integrity Failures | Verify updates/dependencies, signed artifacts |
| 9 | Logging Failures | Log security events, don't log secrets |
| 10 | SSRF | Validate/allowlist URLs, restrict outbound requests |
