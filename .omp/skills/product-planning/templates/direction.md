Template, not an approved product artifact

Apply the Entry protocol and Return contract in `skill://product-planning` before using this content shape; states, readiness and DoD also come from that skill. Template prompts do not authorize new work. Use `Unknown — [reason; how to resolve]` for missing facts; remove instructional placeholders and irrelevant optional fields. For review/editorial work, preserve the existing artifact rather than filling every section. Read-only roles return content to the parent; this template grants no persistence, approval or release authority.

# Product Direction: [Product / direction]

Product Direction owns product why, discovery, evidence and outcomes. For initial drafting, start a bounded Direction draft before research is complete; label unknown inputs as questions or hypotheses. Other operations do not restart discovery or generate descendants. PDD means Product Design Document: a selected Feature's solution/experience design companion, not this root document. Feature remains the requirements source; engineers/Tech Lead own technical implementation contracts.

## Document controls

- ID: [existing Direction ID, otherwise unique draft convention DIR-001 after checking active and historical IDs; not a tracker ID]
- Current candidate / revision, when needed: [identity required by current approval/evidence; v0 may identify an initial draft; no invented revision lineage]
- Parent reference: [None — root direction document; link any existing upstream mandate]
- document_status: [Draft | In Discovery | Direction Approved]
- Direction approval: [decision owner, reference, date if supplied and exact approved candidate/scope; required only for Direction Approved]
- outcome_status: [Not measured | Measuring | Supported | Not supported | Inconclusive]
- Owner: [named Product Manager or Unknown / proposed owner, explicitly labeled; user, UX and Tech Lead input as relevant]
- Evidence / decision references: [IDs, paths or URLs, relevant revisions/dates]

Direction approval is not evidence validation, design approval, delivery acceptance or release approval. Outcome status describes measured results, not confidence or document maturity. An explicitly authorized artifact migration may retain an earlier approval identity only as historical provenance for its unchanged direction scope; renaming does not approve new scope or a new Product Design artifact, and retired IDs are not available for new design candidates.

## Vision, users and problem

- Vision / desired change: [for whom, what becomes better and why]
- Users and context: [affected populations, jobs, situations and exclusions; sources or hypotheses]
- Problem and impact: [observed pain versus inferred cause; frequency/severity only when sourced]
- Current alternatives: [what people do today, including doing nothing; strengths, costs and gaps]
- Why investigate now: [source-backed trigger or explicit hypothesis]

## Evidence and hypotheses

Include counterevidence. `Validated` means a bounded criterion was actually met with source, date, population, method and limits recorded; founder or stakeholder approval never validates evidence. `Supported` is not automatically `Validated`.
Use stable semantic claim/decision IDs, not question-round labels. Keep current supporting and contrary evidence; provenance dates and validation methods are not revision-change history.

| Evidence ref / claim | evidence_status: Hypothesis / Supported / Contradicted / Inconclusive / Validated | Source and date | Population / context and method | Observation, counterevidence and limits | Bounded validation criterion and actual result, if claiming Validated |
| --- | --- | --- | --- | --- | --- |
| [ref / claim] | [status] | [source; freshness] | [who; how obtained] | [what is known and not generalizable] | [criterion + result, or not claimed] |

| Hypothesis / evidence refs | Bounded question and proposed test | Population / safe scope / owner | Support, reject or inconclusive decision rules | Limits / risks | Actual result refs and resulting decision |
| --- | --- | --- | --- | --- | --- |
| [falsifiable claim] | [method, not a claim of execution] | [sample rationale; consent/privacy where relevant] | [predefined criteria or proposal needing agreement] | [bias; what the test cannot establish] | [Not run, or observed evidence and decision] |

## Outcomes and measurement

Do not invent baselines, targets or dates. Label targets as proposed unless accepted with a decision reference. An unknown baseline needs a collection plan, not a fabricated value.

| Desired outcome / population | Metric definition, unit and window | Baseline / source / date | Target and decision ref, or proposal | Measurement source / method / owner | Guardrails and outcome evidence / status |
| --- | --- | --- | --- | --- | --- |
| [change sought] | [observable calculation and period rationale] | [known baseline or Unknown + plan] | [bounded desired change] | [instrumentation needed; safe collection] | [harm checks; measured result or Not measured] |

## Journeys and direction

- Current journey: [trigger → relevant steps → result; pain points and evidence refs]
- Desired journey hypothesis: [possible changed experience; do not present an untested solution as settled; detailed selected Feature design belongs in its PDD when assigned]
- Scope now: [problem, users and learning boundaries selected for the current direction]
- Non-goals: [explicit exclusions and why]
- Constraints: [known business, accessibility, security, privacy, data, operational or technical constraints; sources and owners, only where relevant]
- Risks: [uncertainty / impact / response / owner; unresolved versus explicitly accepted risk with decision reference]

## Current decisions, blockers and assigned research

| Semantic decision ID / current question | Evidence and alternatives | Recommendation / trade-off | Decision owner | Applicable decision source / scope, or pending |
| --- | --- | --- | --- | --- |
| [stable concept, not a Q&A round] | [refs; include contrary evidence] | [proposal, not approval] | [name or Unknown] | [current recorded decision or pending; not a review timeline] |

| blocked_by reference, or None | Actual prerequisite / affected work | Ready condition | Input owner / next action |
| --- | --- | --- | --- |
| [input, decision or item] | [what cannot proceed without it] | [observable condition] | [who supplies it] |

Unknowns do not prevent drafting Product Direction. Block only work that truly needs the missing input; do not create role-order dependencies or cycles. Research does not require a completed or approved PDD; Research/Spike/Enabler Tasks may attach directly to this Direction when it is the closest justified parent, with rationale and a learning/unblock exit.

- Next bounded research, only if assigned: [priority question, method, safe scope, learning exit condition and owner]
- Discovery readiness: [whether that question/method/safe scope is defined; missing prerequisite if not]
- Next refinement, only if assigned: [rough Epic candidates and rationale; no full Feature/PDD/Story/Task expansion]
- Direction review, if requested: [evidence sufficiency and limits, unresolved decisions, exact approval sought; never self-approve]

## Handoff

Response metadata, not a required persisted section. Select delivery using the skill's Return contract.

- **Outcome:** [current discovery conclusion, document/outcome states and unapproved decisions]
- **Deliverables:** [complete assigned Direction for `full_artifact`; changed paths for `file_summary`; bounded findings for `assessment`; no automatic descendant drafts]
- **Evidence:** [observed support, counterevidence and measurement/test limits; distinguish proposed work]
- **Risks and blockers:** [remaining gaps, prerequisites and ready conditions]
- **Next owner:** [named owner or Unknown / proposed; exact action or decision needed]
