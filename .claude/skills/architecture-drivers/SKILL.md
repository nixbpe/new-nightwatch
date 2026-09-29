---
name: architecture-drivers
description: Quality attributes the Technical Lead checks when making or reviewing a design decision. Use for design work and for implementation that changes architecture.
---

# Architecture Drivers

## What this is for

A checklist of the qualities a design decision can affect. Check only the ones the decision actually touches, so small changes stay small. DB/RLS and security checks that the change requires are never optional.

## Drivers

Weigh each touched driver against the requirements, constraints and principles already approved:

- **Runtime**: performance (response time/latency), scalability (load per window), availability (nines as permitted downtime) and disaster recovery (RTO/RPO).
- **Protection**: security (authentication, authorization, confidentiality in transit/at rest, OWASP), privacy (personal data/GDPR), audit (who, when, why, before/after values and erasure conflicts), and legal/compliance (AML, GDPR, digital-services taxation).
- **Operability**: monitoring (read-only health, metrics, alerts), management (topology, cache refresh, feature toggles), maintainability (owner and required knowledge), flexibility (change direction/cost), accessibility (W3C), and internationalization (cheap upfront, costly retrofit, including RTL).
