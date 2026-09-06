Template, not an approved product artifact

Read `skill://product-planning` for canonical states, readiness and Definition of Done (DoD). Use `Unknown — [reason; how to resolve]` for missing facts. Replace or remove instructional placeholders; never copy unanswered prompts as final factual requirements. Return drafts to the parent; this template grants no authority to persist, approve, file or release anything.

# PDD: [Product / direction]

PDD means this project's **Product Discovery & Definition Document**, not a universal standard. Start with PDD v0 before research is complete; label unknown initial inputs as questions or hypotheses and refine with evidence. Do not generate the whole delivery hierarchy by default.

## Document controls

- ID: [existing ID, otherwise draft convention PDD-001; not a tracker ID]
- Revision: [current revision; v0 for the initial draft]
- Parent reference: [None — root direction document; link any existing upstream mandate]
- document_status: [Draft | In Discovery | Direction Approved]
- Direction approval: [decision owner, reference, date and approved revision/scope; required only for Direction Approved]
- outcome_status: [Not measured | Measuring | Supported | Not supported | Inconclusive]
- Owner: [named owner or Unknown / proposed owner, explicitly labeled]
- Evidence / decision references: [IDs, paths or URLs, relevant revisions/dates]
- Revision changes: [what changed and which evidence/decision caused it]

Direction approval is not evidence validation, delivery acceptance or release approval. Outcome status describes measured results, not confidence or document maturity.

## Vision, users and problem

- Vision / desired change: [for whom, what becomes better and why]
- Users and context: [affected populations, jobs, situations and exclusions; sources or hypotheses]
- Problem and impact: [observed pain versus inferred cause; frequency/severity only when sourced]
- Current alternatives: [what people do today, including doing nothing; strengths, costs and gaps]
- Why investigate now: [source-backed trigger or explicit hypothesis]

## Evidence and hypotheses

Include counterevidence. `Validated` means a bounded criterion was actually met with source, date, population, method and limits recorded; founder or stakeholder approval never validates evidence. `Supported` is not automatically `Validated`.

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
- Desired journey hypothesis: [possible changed experience; do not present an untested solution as settled]
- Scope now: [problem, users and learning boundaries selected for this revision]
- Non-goals: [explicit exclusions and why]
- Constraints: [known business, accessibility, security, privacy, data, operational or technical constraints; sources and owners, only where relevant]
- Risks: [uncertainty / impact / response / owner; unresolved versus explicitly accepted risk with decision reference]

## Decisions, blockers and next research

| Decision / question | Evidence and alternatives | Recommendation / trade-off | Decision owner | Actual decision ref / revision, or pending |
| --- | --- | --- | --- | --- |
| [decision needed] | [refs; include contrary evidence] | [proposal, not approval] | [name or Unknown] | [recorded decision or pending] |

| blocked_by reference, or None | Actual prerequisite / affected work | Ready condition | Input owner / next action |
| --- | --- | --- | --- |
| [input, decision or item] | [what cannot proceed without it] | [observable condition] | [who supplies it] |

Unknowns do not prevent drafting PDD v0. Block only work that truly needs the missing input; do not create role-order dependencies or cycles.

- Next bounded research: [priority question, method, safe scope, learning exit condition and owner]
- Discovery readiness: [whether that question/method/safe scope is defined; missing prerequisite if not]
- Next refinement, only if assigned: [rough Epic candidates and rationale; no full Feature/Story/Task expansion]
- Direction review, if requested: [evidence sufficiency and limits, unresolved decisions, exact approval sought; never self-approve]

## Handoff

- **Outcome:** [current discovery conclusion, document/outcome states and unapproved decisions]
- **Deliverables:** [this revision and assigned draft artifacts only]
- **Evidence:** [observed support, counterevidence and measurement/test limits; distinguish proposed work]
- **Risks and blockers:** [remaining gaps, prerequisites and ready conditions]
- **Next owner:** [named owner or Unknown / proposed; exact action or decision needed]
