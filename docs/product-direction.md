# NightWatch — Product Direction

| Field           | Value                                                    |
| --------------- | -------------------------------------------------------- |
| ID / revision   | DIR-001 / v2                                             |
| document_status | Direction Approved                                       |
| outcome_status  | Not measured                                             |
| Owner           | Product Owner role; accountable person not yet confirmed |

Product intent only; it lists neither implemented capabilities nor validated demand. Each section gives its principle, then only the numbered items that decisions or studies cite. Items are numbered in order within each section; after adding or removing one, renumber and update every reference.

## Positioning

**Principle.** NightWatch helps service-provider Platform/SRE teams responsible for AWS security choose which technical risks to fix first across one customer's Projects, with inspectable reasons, evidence, data limits and practical next steps: understand the order, inspect its basis, choose the next action. Any advantage over existing tools is a hypothesis.

## Decisions (settled; do not re-ask)

- D1 Primary user is Platform/SRE responsible for security. Security specialists, access administrators and action owners support them; auditors, compliance and IAM/GRC are out of scope.
- D2 The main job is choosing what to address first; change detection and remediation verification are out of scope.
- D3 Rank by observed technical context such as exposure and permissions, beyond severity alone.
- D4 With incomplete context, give a provisional order with knowns and unknowns; missing data never implies low risk.
- D5 Done when the user can decide the next action from reasons, affected resources and guidance. No native assignment, ticketing or completion tracking.
- D6 Segment is providers managing AWS for several customer organizations; buyer, access approver and pilot participants are unknown.
- D7 Compare Projects within one customer only.
- D8 No business criticality; the technical order is never presented as the best business order.
- D9 The order is explainable with inspectable evidence; numeric scores and grouping are not required.

## Scope and trust

**Principle.** One customer is one Organization and the isolation boundary; a Project holds authorized cloud scope and observations, and comparisons never leave one Organization, whatever other memberships a user has. Keep provenance, scope and freshness visible: missing context is not low risk, and no findings is not proof of safe or complete collection. Advice is never execution, assignment or proof of a fix. Partial, stale or uneven data and missing permissions stay understandable, and unsupported inferences never appear as facts.

- S1 Out of the first scope: autonomous cloud changes, certification guarantees, exhaustive-detection claims and provider parity. AWS-first is not full AWS coverage; other providers need their own decision.
- S2 Reports, notifications, health and SLOs, access governance and broader compliance are possible later capabilities.
- S3 This document does not authorize collecting customer credentials or sensitive evidence.

## Discovery (all Hypothesis, Not run)

**Principle.** Agree cohort, tasks, rubric and support/reject criteria before a study and never fit them to results. Participant research needs consent, safe materials, a named owner and authorization. Native action coordination is out of the study per D5.

- H1 Provider operators have a recurring within-customer prioritization problem (first study: walk through recent decisions with Platform/SRE staff).
- H2 Explainable cross-Project technical ordering improves next-action decisions over the current method.
- H3 Operators read provisional recommendations safely (knowns versus unknowns, technical versus business).
- H4 A bounded AWS scope gives enough context for the job.
- H5 The value justifies adoption and operating cost.

## Outcome and measures (proposals; no baselines or targets)

**Principle.** Operators choose a defensible next action across one customer's Projects with less effort, without being misled by incomplete data or taking technical order for business priority. Speed never counts as success on its own.

- M1 Task success (primary): tasks meeting the agreed rubric divided by all attempted, abandoned ones included.
- M2 Decision effort: minutes and context-gathering steps to a decision.
- M3 Safe interpretation (guardrail): adverse-data scenarios explained correctly divided by attempted; averages must not hide false-safety or cross-customer mistakes.
- M4 Time to a usable comparison: minutes from authorized setup to a correct cross-Project review, never improved by hiding access needs or shrinking coverage.

## Open decisions

Unknowns block only the work that depends on them.

| Decision                                                  | Owner (proposed)                       |
| --------------------------------------------------------- | -------------------------------------- |
| Pilot providers, buyer and access approver                | User with PO                           |
| Supported AWS scope and technical signals                 | Product with technical/security        |
| Ranking and explanation contract within D3, D4, D8 and D9 | Product with technical/security and UX |
| Deployment, data control, retention and cost boundaries   | Product with platform/security         |
| Research protocol and outcome thresholds                  | PO/UX with security                    |
