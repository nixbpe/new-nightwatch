# NightWatch — Product Direction

| Field | Value |
| --- | --- |
| ID / revision | DIR-001 / v2 |
| document_status | Direction Approved |
| outcome_status | Not measured |
| Owner | Product Owner role; accountable person not yet confirmed |

Product intent only; not a list of implemented capabilities or validated demand. Terminology follows [AGENTS.md](../AGENTS.md); **Project** is the operational product term.

## Positioning

NightWatch helps service-provider Platform/SRE teams responsible for AWS security choose which technical risks to fix first across one customer's Projects, with inspectable reasons, evidence, data limits and practical next steps. Value: understand the order → inspect its basis → choose the next action. Advantage over existing tools is a hypothesis.

## Direction decisions (settled; do not re-ask)

- D1 Primary user: Platform/SRE responsible for security. Security specialists, access administrators and action owners are supporting; auditors, compliance and IAM/GRC are adjacent and out of scope.
- D2 Main job: identify and prioritize what to address first (not change detection or remediation verification).
- D3 Rank by observed technical context such as exposure and permissions, not severity alone.
- D4 With incomplete context, give a provisional order and show knowns and unknowns; missing data never implies low risk.
- D5 Done when the user can decide the next action (reasons, affected resources, remediation or investigation guidance). No native assignment, ticketing or completion tracking.
- D6 Segment: providers managing AWS for multiple customer organizations. Buyer, access approver and pilot participants are unknown.
- D7 Compare Projects within one customer only; never across customers.
- D8 No business criticality; the technical order is not claimed to be the best business order.
- D9 An explainable order with inspectable evidence; numeric scores and common-cause grouping are not required.

## Concepts

- Organization: one customer, and the tenant isolation boundary. "Customer" is business wording, not a separate entity.
- Project: operational unit holding authorized cloud scope and observations; comparisons span Projects in one Organization.
- Cloud target/resource, finding/evidence (with provenance, scope, freshness, limits) and priority recommendation (a relative, explainable order, not a completeness or business-optimality promise).

## First-scope boundaries

- One customer's authorized Projects at a time (D7). Separate memberships in other Organizations never widen a comparison.
- No business-criticality ranking (D8), required score or grouping (D9), or native assignment, ticket delivery, remediation lifecycle or proof-of-fix (D5).
- No autonomous cloud changes, certification guarantee, exhaustive-detection claim or provider parity; AWS-first does not mean full AWS coverage, and other providers (including GCP) need their own scope decision.
- Reports, notifications, health/SLOs, access governance and broader compliance are possible later capabilities, not first-scope requirements.
- The ranking formula, signal precedence and AWS check coverage are open (see Open decisions).

## Trust rules

- Isolation: every comparison stays inside one Organization with authorized Project visibility, under the architecture rules.
- Evidence: keep provenance, scope and freshness visible. Missing context is not low risk; no findings is not proof of complete or safe collection.
- Explanation: separate technical risk from business priority; state the basis and limits of provisional orders without implying precision.
- Action: advice is not execution, assignment or proof of remediation; a finding disappearing does not prove a fix.
- Partial collection, stale data, uneven Project coverage and missing permissions must stay understandable. Unsupported inferences about exposure, impact or remediation never appear as facts.
- Accessibility follows [Design rules](design-system.md).
- This document does not authorize collecting customer credentials or sensitive evidence.

## Hypotheses and discovery (all Hypothesis, Not run)

- H1 Provider operators have a recurring within-customer prioritization problem. First study: walk through recent decisions with Platform/SRE staff.
- H2 Explainable cross-Project technical ordering improves next-action decisions over the participant's current method.
- H4 Operators interpret provisional recommendations safely (knowns vs unknowns, technical vs business).
- H5 A bounded AWS scope gives enough context for the job.
- H6 The value justifies adoption and operating cost.
- H3 (native action coordination) is out of the initial study per D5.

Agree cohort, tasks, rubric and support/reject criteria before any study; do not fit criteria to results. Participant research needs consent, safe materials, a named owner and authorization.

## Outcome and measures (proposals; no baselines or targets)

Primary outcome: operators choose a defensible next action across one customer's Projects with less effort, without being misled by incomplete data or confusing technical order with business priority.

- Task success (primary): tasks meeting the agreed rubric ÷ all attempted, including abandoned ones; speed or agreement with the displayed order is not correctness.
- Decision effort: minutes and context-gathering steps to a decision; faster wrong or abandoned tasks are not improvement.
- Safe interpretation (guardrail): adverse-data scenarios explained correctly ÷ attempted; averages must not hide false-safety or cross-customer mistakes.
- Time to a usable comparison (adoption): minutes from authorized setup to a correct cross-Project review; never improved by hiding access needs or shrinking coverage.

## Open decisions

| Decision | Owner (proposed) |
| --- | --- |
| Pilot providers, buyer and access approver | User with PO |
| Supported AWS scope and technical signals | Product with technical/security |
| Ranking and explanation contract within D3/D4/D8/D9 | Product with technical/security and UX |
| Deployment, data control, retention and cost boundaries | Product with platform/security |
| Research protocol and outcome thresholds | PO/UX with security |

Unknowns block only the work that depends on them.
