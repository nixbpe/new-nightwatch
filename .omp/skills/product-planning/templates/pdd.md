# Product Design Document (PDD) Template

PDD describes **how people experience a selected Feature**: journeys, interaction decisions, states, content, accessibility, and design verification. It is a Feature design companion, not Product Direction/discovery, a duplicate PRD, an engineering SDD, or an RPA Process Definition Document. Feature remains the functional-requirements authority. Read the canonical skill before consuming this template.

## Consumption contract

- Author only the assigned artifact, candidate, and scope. Do not create missing Direction, Feature, Stories, research, prototypes, or technical designs automatically. Missing upstream inputs become explicit questions; discovery does not require a finished PDD.
- UX/Product Designer authors design with PM collaboration; PO owns Feature requirements; engineering owns technical contracts. An author may propose design, not silently accept a new business rule, assign another person, or grant approval.
- `M` means **assess this concern for the selected scope**, not invent content. `C` means conditional detail. Use `Not applicable — reason` when supported; insufficient information is `Unknown — missing input and consequence`, not N/A. Non-UI scopes need not acquire fictional screens.
- `Mini` uses concise records and linked existing evidence for a bounded, low-risk change. `Full` expands affected flows, alternatives, state combinations, and verification for complex, sensitive, or high-impact changes. Record the rationale; Mini never waives applicable privacy, accessibility, security, or error behavior. A targeted refinement does not require unrelated template backfill or a new document set.
- Keep identifiers and semantic field keys stable; write narrative in the user's language. Template alternatives and sample IDs are instructions, not artifact facts. Preserve supplied IDs; never reuse a retired discovery PDD ID for a Product Design artifact.
- Use one canonical decision record: `value`, `decision_state: Accepted | Proposed | Unknown`, `basis`. Accepted requires a supplied settled decision for this scope; an inferred recommendation is Proposed. Do not emit competing Unknown and chosen values. Link reused records rather than copying them.
- Separate evidence from decisions: identify source/candidate, observation, interpretation, and limits. A requested design, plausible persona, mockup, synthetic check, or Approved document is not user validation or runtime proof. Never invent interviews, metrics, compliance, signatures, dates, URLs, or completed verification.
- Preserve supplied accepted requirements and decisions. Surface conflicts with source and impact; propose a separately identified change for its actual owner. Design approval does not override Feature requirements or engineering/security contracts.
- Render a current-state artifact, not a chat transcript. Follow the canonical output mode and bounded handoff contract; no automatic execution, descendant generation, release, or independent acceptance.

## 0. Cover, candidate, and review ownership — M

| Field | Value |
|---|---|
| `pdd_id` / title | Stable Product Design ID / selected Feature design |
| `current_candidate` | Exact revision, commit, or other retrievable candidate |
| `parent_feature` | Feature ID, candidate, and source; direct parent |
| `direction_ref` / `epic_ref` | Upstream traceability through Feature; Unknown if unavailable |
| `document_status` | Draft / In Review / Approved / Superseded |
| `detail_level` | Mini / Full, decision state and risk rationale |
| `design_owner` / `pm_partner` / `requirements_owner` | Supplied assignment/source or Proposed/Unknown; role is not a confirmed person |
| `created_at` / `updated_at` | Known dates only; otherwise Unknown |
| `design_scope` | Included flows, actors, surfaces and explicit exclusions |
| `related_artifacts` | Feature requirements, existing PRD if any, architecture/SDD, design system, prototype and research candidates |
| `approval_record` | Actual reviewer, authority, exact candidate/scope, decision, date, source and conditions; otherwise Not approved |
| `supersedes` / `superseded_by` | Applicable candidate references and reason; otherwise None |

Use a risk-appropriate review matrix: `boundary | reviewer/authority | assignment basis | candidate/scope | requested review | actual result/evidence | unresolved condition`. Include UX, PM/PO, engineering, QA, security/privacy/legal, accessibility, or operations only for affected boundaries. Do not invent universal serial sign-offs. `In Review` needs an actual review submission; `Approved` needs explicit authorized approval of this candidate/scope. A materially changed candidate does not inherit approval. `Superseded` records its replacement, not failure of the product hypothesis.

## 1. Executive summary — M

In a short paragraph or bullets state: `problem_ref`, affected users, selected solution/experience, intended outcome and `metric_refs`, scope boundary, highest unresolved risk, and decision/review requested. Distinguish what is accepted from the proposed design. Link original discovery in Direction; do not restart or duplicate it.

## 2. Context and problem — M

- `context_sources`: Feature/Direction candidates, present workflow, constraints, existing experience and known incidents.
- `problem`: observable friction and its impact; distinguish supplied facts from inferred causes.
- `evidence_limits`: research method/sample/date if actually available, counter-evidence and missing information. Research not run remains Not run.
- `design_trigger`: why this selected change is needed now, with source or explicitly proposed rationale.

## 3. Goals and non-goals — M

| `goal_id` | User/business goal and upstream requirement | Observable success / metric reference | Decision state and basis |
|---|---|---|---|
| Supplied or new stable ID | Selected scope only | Existing definition or Proposed/Unknown target | Accepted / Proposed / Unknown + source |

List explicit `non_goals`, constraints and deferred scope with reasons. A non-goal cannot silently remove an accepted requirement. Do not invent thresholds or delivery commitments to fill a measurable-goal field.

## 4. Users, personas, and jobs to be done — M

Record `actor_id | source | context/needs | job and desired outcome | relevant ability, permission or access constraints | evidence limits`. Separate actual research-based personas from proposed archetypes. Capture affected secondary actors and support/operational users only when relevant. In NightWatch use **Project** as the product term; tenant and authorization boundaries remain governed by accepted requirements and architecture.

## 5. Journeys and user flows — M

For each selected flow record:

- `flow_id`, actor, requirement/goal references, entry trigger and preconditions.
- Steps with user action, visible system response, decision branch, and exit/postcondition.
- Applicable alternative, interruption, cancellation, recovery, failure and permission-denied paths; cite accepted policy or mark proposed behavior. Do not invent retries or redirects as generic improvements.
- Cross-surface/device continuation, async work, return visits and state persistence only where relevant.
- Diagram/prototype links and unresolved branches. A concise sequence is enough when a diagram adds no information.

## 6. Information architecture — C

When navigation or content structure changes, describe `node_id | label | parent/location | user task | entry/exit routes | visibility rule reference`. Show sitemap, grouping, search/findability, breadcrumbs or deep-link behavior only as affected. Prefer the existing structure; distinguish navigation visibility from server-side authorization. Otherwise state why IA is unchanged or not applicable.

## 7. Wireframes and prototypes — M

Record `design_ref | exact file/frame/version | flow/state coverage | fidelity and rationale | author/source | review/verification evidence | gaps`. Use the lowest fidelity that resolves the actual risk; visual polish is not proof of usability. Link real artifacts only; a missing frame/prototype remains Unknown or explicitly not yet produced. Describe responsive layouts and representative content/data extremes when applicable. Do not require a tool-specific deliverable or fabricate a Figma URL.

If usability evaluation is assigned, state question, representative participants/context, method, observable criteria, ethical/privacy constraints and actual findings. A plan is not a completed study. Design approval or a tool's “Ready for dev” label is not implementation readiness, usability validation, QA acceptance, or release authority.

## 8. Interaction and UI-state specification — M

| `interaction_id` / flow | Trigger and precondition | State / visible response | Allowed action and next state | Requirement / decision / design reference | Verification and remaining gap |
|---|---|---|---|---|---|
| Stable scoped ID | Actor, input and current state | Observable behavior, not internal implementation | Include focus and announcement effects when applicable | Exact candidate refs | Scenario and actual result or Not run |

Assess applicable loading, empty, error, success, disabled, focus and hover states. Distinguish first-use empty from no search results, denied access, stale/partial data, and unavailable service where they produce different user outcomes. Define validation timing, progress, confirmation, cancellation and recovery only within accepted scope. Keep safe error disclosure and authoritative error/permission rules linked to their source.

Cover meaningful combinations and transitions rather than a Cartesian checklist: e.g. keyboard focus during loading, validation plus server failure, permission changes during async work, locale changes with pending input, duplicate submission or late responses **when plausible for this flow**. Specify precedence, preserved input and recovery for those risks. Never infer business policy or authorization from a visual state.

## 9. Content and microcopy — C

For changed content record `content_id | flow/state | purpose | TH text | EN text | locale applicability | decision state/source | review gap`. Use clear actions, consistent terms, helpful validation and recovery messages, and privacy-conscious error wording. Include consent/notice copy only when applicable and tied to its lawful-purpose decision; draft copy is not approved legal language. Preserve semantic IDs across translations. Do not invent required English copy when language scope is unconfirmed.

## 10. Accessibility — M

- `target`: exact standard/version/level, applicable surfaces/processes, requirement source and decision state. Preserve accepted project/design-system rules. If no target exists, WCAG 2.2 AA may be **Proposed**, not silently accepted or legally mandated.
- `design_requirements`: assess semantic structure, keyboard access/order/traps, visible and unobscured focus, names/labels/instructions, screen-reader announcements, errors, contrast/non-color cues, zoom/reflow, target size, motion, media alternatives and time limits as applicable. Link criteria rather than relying on a fixed criterion count.
- `verification`: map affected criteria and complete journeys to method, actual browser/device/assistive-technology environment, candidate and evidence; distinguish design inspection, automated checks and manual runtime checks. Record exclusions, failures and untested coverage.
- `conformance_limits`: WCAG AA means meeting A and AA requirements across full pages and complete processes in scope, including relevant responsive variants—not an approved mockup or a passing scanner. Never claim conformance without adequate evidence.
- `government_applicability`: identify jurisdiction, agency/contract, exact DGA/TWCAG edition and binding or recommended status. Use §21 sources as orientation and verify the applicable version; do not assume an unsourced “TWCAG 2025” or that every Thai product is a government website.

## 11. Localization and regional behavior — M

Assess `locale_scope` (including TH/EN for Thai or government contexts), language switching, text expansion/wrapping, fonts, mixed-language input/search/sorting, locale persistence, date/calendar/time zone, numbers/currency/units, address/name formats, and fallback/missing translations as relevant. Record accepted rules or Proposed/Unknown decisions with sources and verification scenarios. Thai language alone does not establish Buddhist calendar, Asia/Bangkok time zone, or a universal English requirement. Separate translated content from locale-dependent business rules; refer changes to their owner.

## 12. Design-system references — C

Link the existing system/version, component, token, typography, icon, responsive and theme rules used by the affected design. In NightWatch consult `docs/design-system.md`; reuse established components and tokens rather than creating a parallel system. For a genuine gap record `gap | alternatives | proposed exception/extension | rationale | owner/review | affected states`. Do not invent component APIs or treat a proposal as a published component.

## 13. Functional requirements and business-rule mapping — M

| `requirement_ref` / source candidate | Actor and accepted behavior / rule | `decision_ref` + flow/state/design references | Verification scenario / acceptance reference | Coverage, conflict or gap |
|---|---|---|---|---|
| Feature owns the requirement | Preserve its authority and decision state | Trace requirement → design choice → observable behavior | Link existing acceptance or propose a bounded scenario | Actual evidence or Not run / Unknown |

Account for every requirement in the selected design scope; unrelated requirements stay outside it. Link existing PRD/Feature definitions instead of duplicating competing copies. Distinguish design coverage from implemented/tested coverage. Route missing or conflicting functional decisions to the requirements owner; do not rewrite the Feature implicitly through a mockup.

## 14. Conceptual data model — C

Describe only concepts required to understand the experience: `concept | user meaning | relationships/cardinality if known | visible lifecycle | ownership/access reference | sensitivity | unresolved question`. Include how users distinguish empty, missing, deleted or inaccessible information where relevant. Keep physical schemas, indexes, storage, migrations and API payloads in engineering-owned architecture/SDD; link them when supplied. Never infer isolation/security enforcement from the conceptual diagram.

## 15. Conceptual integrations — C

Record `touchpoint | user purpose | actor/system responsibility | input/output concepts | trust/permission boundary | visible waiting/failure/recovery | authoritative contract ref | unresolved dependency`. Cover third-party redirects or handoffs only when in scope. Engineering owns endpoints, authentication protocols, retry/idempotency semantics and operational contracts; preserve supplied rules and ask for missing decisions rather than inventing technical details.

## 16. Nonfunctional requirements, security, privacy, and regulation — M

### Measurable requirements

Use `nfr_id | category | affected flow | observable requirement/threshold | source and decision state | verification method/environment | result or gap`. Assess performance/responsiveness, availability/resilience, supported surfaces, accessibility, security and privacy as applicable. Missing baselines/targets remain Unknown or a clearly justified proposal; do not declare arbitrary latency, uptime or retention figures accepted. Link architecture for enforcement and operations for runbooks.

### Security and privacy applicability

Record processing purpose, data categories/subjects, controller/processor responsibilities, exposure/access boundaries, jurisdictions and legal/contract sources. Keep an explicit `Applicable | Not applicable | Unknown` assessment with basis for each affected concern below. No data supplied is not proof that no personal data is processed; telemetry and support exports count too. Identify a confirmed legal/privacy decision owner or Unknown, not an invented approval.

| Concern | Required assessment when applicable |
|---|---|
| Lawful basis and transparency | Per purpose: basis, necessity/minimization, notice timing/content, recipient categories and source. PDPA consent is not the only basis; §24 and other applicable provisions allow specified alternatives. A proposed basis requires authorized assessment, not AI legal approval. |
| Consent and withdrawal | When relying on consent: freely given, intelligible, separated purpose-specific request; record/evidence, relevant capacity/minor rules, refusal and withdrawal flow. §19 requires withdrawal as easy as giving consent, subject to its statutory limits, with effects communicated. Do not automatically terminate unrelated service, erase every record, or silently switch basis; identify any lawful continuing processing and applicable exceptions. |
| Data subject rights | Access/copy and source information, portability, objection, erasure/destruction/anonymization, restriction, rectification and complaint channels under applicable provisions. Record basis-dependent conditions/exceptions, identity verification, request channel, responsible operator, sourced deadline, decision/denial explanation and downstream handling. Do not promise universal rights or invent self-service screens: operational channels may be the accepted design. |
| Sensitive data | Identify §26 categories actually involved, required explicit consent or a specifically applicable exception, safeguards, exposure minimization and authorized review. Ordinary personal data and sensitive data are not interchangeable; not all §26 processing requires consent in every circumstance. |
| Breach and incident communication | Link the operational procedure and responsible controller/processor contacts; assess awareness trigger, risk, recipients, notification content and deadlines. Under §37(4) and the 2565 breach notice, controller notification to PDPC is without undue delay, within 72 hours of awareness where feasible, unless there is no risk to rights/freedoms; high risk also requires notifying affected subjects without delay with remediation. Record assessment evidence, processor escalation, phased information and reasons for delay as applicable. The notice's 15-day provision concerns requesting consideration of exemption from delayed-notification liability under specified conditions—not a routine extension or grace period. Do not promise a universal incident deadline or create an incident-response UI without scope. |
| Retention, deletion and anonymization | Purpose/category-based retention period or determination criteria and source; deletion/anonymization trigger, legal holds/exceptions, copies/backups/recipients and observable user communication. §23 and §37 obligations do not supply one universal retention duration. Pseudonymized data is not automatically anonymous. Link implementation/runbook responsibilities rather than inventing storage policy. |
| Cross-border transfers | Identify destination/recipients and transfers, including providers/support where relevant. Assess §§28–29 and applicable current notices: adequacy, permitted exception, approved intra-group policy or other applicable safeguards. Foreign hosting is neither automatically prohibited nor automatically compliant; do not invent localization mandates or approval. |

Treat this as a design assessment, not exhaustive legal advice or a compliance certificate. Record exact provision/version, applicability rationale, conflicting sources and review gaps. Older legal compilations may contain expired transitional exemptions; do not adopt those as current rules. High-risk/sensitive work warrants Full detail for affected boundaries and authorized privacy/security review, not automatic new DPIA or implementation tasks. A legally required additional assessment is an explicit dependency with source and owner.

## 17. Success metrics and instrumentation — M

Reference the authoritative Direction/Epic/Feature outcome records; PDD does not own a second outcome lifecycle. Use `metric_ref | design question | behavior/event | trigger and counting rules | minimum properties | privacy/basis/retention ref | data source/owner | baseline/target source | verification/evidence gap`. Add events only when assigned and necessary; proposed instrumentation remains Proposed. Do not include secrets or unnecessary personal data. Distinguish usability/task-success evidence, diagnostic signals and business outcomes; none alone proves causation. No invented dashboards, active events or measured results.

## 18. Decisions and design ADRs — M

For each meaningful choice maintain one stable `decision_id`, context/question, alternatives, `value`, `decision_state`, `basis` (source/evidence or rationale/unknown reason), consequences/tradeoffs, affected requirement/flow, and review authority if supplied. Link an existing ADR when it is authoritative; do not duplicate technical architecture decisions.

Accepted decision records are append-only. When changing one, preserve the prior record and approval provenance, add a new Proposed decision with `supersedes`, reason and impact; acceptance of the replacement must come from its owner. A draft proposal does not supersede the accepted baseline. The current-state design points to the currently accepted record and clearly marks pending alternatives; after acceptance it points to the replacement. Keep material decision history, not every wording edit or a second general changelog.

## 19. Open questions, risks, and dependencies — M

- Questions: `question_id | missing input | affected decision | consequence | owner/assignment basis | next evidence/action`. Do not ask what provided artifacts can answer.
- Risks: `risk_id | plausible cause/event/impact | evidence or inference | mitigation/proposal | verification | owner`.
- Dependencies: `dependency_id | required input/decision/capability | provider and confirmed status | why it blocks this scope | needed-before boundary | fallback if actually agreed`.

Separate an actual blocker from a nonblocking unknown, design recommendation, or ordinary future work. Do not make optional prototype fidelity, missing ceremonial approval or an unrelated template section a gate. Do not conceal a real authorization/privacy/requirements blocker behind “ready”.

## 20. MVP, rollout, migration, and rollback — M

Reference the selected Feature/Epic slice rather than inventing a second MVP. Record applicable included/excluded experience, user cohorts/flags and authority if known, compatibility/transition guidance, data or user migration impact, training/support, monitoring signals, rollout prerequisites, pause/rollback triggers, decision owner and recovery constraints. Link engineering/operations plans; do not create deployment steps, dates, cohorts or reversible-data guarantees without a source. If no change to rollout is assigned, assess impact and retain the upstream plan.

Handoff records `candidate/scope | recipient role | requirements/design/technical refs | decision requested | completed evidence | remaining blockers | next authorized action`. Stories remain children of Feature and reference the applicable PDD candidate. Approval of design does not authorize implementation, data migration, deployment or release. Respect the requested output mode; do not generate Stories/Tasks automatically.

## 21. Appendices, references, and history — C

Link the glossary, source register, research notes, prototype candidates, requirement/verification records and material approval/supersession history where useful. Maintain `source_id | authoritative URL/path and section | edition/effective date if known | scope/applicability | evidence limitations`. Do not create empty appendix documents or mandatory standalone PRDs/ADRs. Remove template instructions from a finished artifact; preserve unresolved assessments honestly.

### Official source orientation

These references ground this template's distinctions, not blanket applicability or a complete legal assessment. Verify amendments, binding contract/agency requirements and current subordinate notices for the actual processing/surface.

- [WCAG 2.2, W3C Recommendation, 12 December 2024](https://www.w3.org/TR/2024/REC-WCAG22-20241212/), especially Conformance Requirements: AA includes A and AA; full pages and complete processes matter.
- [DGA Government Website Standard, มสพร. 11-2566, version 3.0](https://standard.dga.or.th/wp-content/uploads/2023/09/มสพร.-11-2566-ว่าด้วยมาตรฐานเว็บไซต์ภาครัฐ-เวอร์ชัน-3.0.pdf), §8 Recommended Features (§8.1 TH/EN; §8.7 accessibility), Appendix ง. This edition references TWCAG 2022; do not relabel it as TWCAG 2025 or treat its recommended features as universal law. [DGA FAQ](https://standard.dga.or.th/faqs/) identifies the published edition.
- [MDES official PDPA legal collection](https://www.mdes.go.th/mission/detail/2319-กฎหมายคุ้มครองข้อมูลส่วนบุคคล), **Personal Data Protection Act B.E. 2562**: §§19–20 consent/capacity, §23 notice/retention information, §24 lawful alternatives, §26 sensitive data, §§28–29 transfers, §§30–36 rights/conditions, §37 controller obligations, §40 processor obligations, §73 complaints. The collection also includes older instruments; their presence is not proof of current applicability.
- [MDES: PDPC personal-data-breach notification notice B.E. 2565](https://www.mdes.go.th/law/detail/6336), dated 6 December 2565, published 15 December 2565: §§5–8 notification/awareness/processor reporting, §9 limited delayed-notification exemption request, §10 high-risk subject notification, §12 no-risk assessment evidence.
