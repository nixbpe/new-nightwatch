Template, not an approved product artifact

Apply the Entry protocol and Return contract in `skill://product-planning` before using this content shape; states, readiness and DoD also come from that skill. Template prompts do not authorize new work. Use `Unknown — [reason; how to resolve]` for missing facts; remove instructional placeholders and irrelevant optional fields. For review/editorial work, preserve the existing artifact rather than filling every section. Read-only roles return content to the parent; this template grants no persistence, approval or release authority.

# Feature: [Observable capability]

This Feature spec is the single requirements source for this Feature: link it from Stories and implementation Tasks; do not create a duplicate PRD layer. Detail selected near-term Features only. Keep conditional sections only when relevant, with a reason for material exclusions.

## Controls and traceability

- ID: [existing ID, otherwise draft convention F-001; not a tracker ID]
- Current candidate / revision, when needed: [identity required by current approval/evidence; omit unnecessary revision lineage]
- Parent Epic: [ID / actual path or supplied source; exact candidate when needed]
- PDD direction: [ID / actual path or supplied source and exact approved scope/candidate with decision ref, or pending]
- Missing ancestor links: [None, or exact missing references; do not fabricate approved parents]
- delivery_status: [Draft | Refining | Ready | In Progress | Blocked | Done | Stopped]
- outcome_status: [Not measured | Measuring | Supported | Not supported | Inconclusive]
- Owner: [named owner or Unknown / proposed owner, explicitly labeled]
- Evidence / decision references: [current support, counterevidence, candidate selection and scope decisions; not a Q&A/review timeline]

## Problem, outcome and scope

- Users / context / problem: [bounded problem and evidence refs; hypotheses labeled]
- Desired outcome: [observable change contributing to the Epic; not merely shipping]
- Scope: [included behaviors and boundaries]
- Non-goals: [explicitly excluded behaviors and adjacent work]
- Current scope acceptance: [decision owner, exact candidate/scope and reference; otherwise pending; editorial completion does not confer acceptance]

## Interactions and requirements

Describe actual product interactions; do not invent a UI, API or schema just to fill the template. Use stable semantic requirement/decision IDs rather than question-round labels. Keep each rule canonical; flows, Stories and criteria reference it rather than restating competing rules.
Separate necessary accepted invariants from unspecified response or interaction choices.
Unresolved UX/security/API alternatives belong in questions/proposals with an owner,
not the committed acceptance table; a Draft heading does not make invented behavior agreed.

Record supplied accepted requirements/invariants below; if none were supplied, state that instead of inventing rows. Unaccepted alternatives stay in Questions, risks and dependencies.

| Semantic requirement ID | Accepted behavior / invariant and applicability | Current contract / decision source |
| --- | --- | --- |
| [stable concept ID] | [actor, operation and exact relevant boundary] | [actual source and scope; not approval inferred from implementation] |

| Flow / actor and trigger | Preconditions and entry state | Interaction / rule refs | Observable result / next state | Relevant alternate, error or recovery path |
| --- | --- | --- | --- | --- |
| [flow ref] | [permissions / context] | [user/system steps] | [visible behavior] | [failure or edge boundary] |

- States and transitions, if stateful: [state definitions, allowed/disallowed transitions, persistence/recovery expectations and rule refs]
- Business rules: [canonical requirement refs; sourced decision logic, precedence and boundaries; do not duplicate the rule text]
- UX / accessibility, where relevant: [approved design refs and interaction/content/accessibility requirements; unresolved needs and owner]
- Security / privacy / data constraints, where relevant: [access boundaries, sensitive data, consent/retention and safe fixtures; sources and review owner]
- Non-functional / operational constraints, where relevant: [measurable limits and verification method; sourced or proposed, never arbitrary thresholds]
- Technical contract references, where needed: [approved versioned API/schema/ADR/integration contracts and owning engineer or Tech Lead; do not invent technical decisions]
- Technical decisions / divergence: [distinguish an unanswered contract choice from observed implementation that differs from an accepted contract; affected behavior, source, owner and required input; no code changes in a docs-only assignment]

| Acceptance ref / requirement refs | Given / trigger or action | Measurable observable result | Safe verification method / fixture | Actual result evidence, when exercised |
| --- | --- | --- | --- | --- |
| [criterion] | [bounded context] | [expected result; relevant failure/permission boundary] | [method and reviewer/owner] | [Not exercised, or observed result ref] |

## Outcome measurement

| Metric / unit / population / window | Baseline / source / date | Target and decision ref, or proposal | Instrumentation / data source / owner | Guardrails, limits and observed outcome refs |
| --- | --- | --- | --- | --- |
| [definition linked to desired outcome] | [known baseline or Unknown + collection plan] | [desired change, not invented] | [events/signals and safe collection needed] | [Not measured or actual results] |

Reference evidence statuses from the PDD/register separately from delivery and outcome. `Validated` requires source/date/population/method/limits and a bounded criterion actually met, never direction approval.

## Questions, risks and dependencies

| Question / explicitly Proposed alternative / risk | Impact on behavior or readiness | Resolution or explicitly accepted risk reference | Owner / next action |
| --- | --- | --- | --- |
| [unresolved point] | [which criterion or decision it affects] | [pending input, or exact recorded acceptance] | [name or Unknown / proposed] |

| blocked_by reference, or None | Actual prerequisite / affected work | Ready condition | Input owner / next action |
| --- | --- | --- | --- |
| [input, decision or item] | [why this input is necessary] | [observable condition] | [who supplies it] |

Parentage is containment, not a dependency. Children may start while a parent is In Progress when their inputs are ready. Do not create role-order edges or cycles.

## Readiness, slicing and completion

- Ready assessment: [evidence for accepted current scope, observable criteria, needed UX/contracts, resolved or explicitly accepted relevant risks, ownership and safe verification; list missing gates and do not self-grant Ready]
- Selected Story references, only when assigned: [ID / actual path or supplied source, candidate when needed, end-to-end slice / acceptance refs; leave future work rough]
- Completion evidence: [current acceptance met; integrated behavior demonstrated; required reviews/risk checks; known gaps recorded; affected contracts/docs updated where needed]
- Release / outcome evidence, if applicable: [independent decision/results; Done ≠ released ≠ outcome achieved]

Task completion alone does not satisfy Story or Feature acceptance. Missing evidence cannot pass DoD, and DoD grants no release authority.

## Handoff

Response metadata, not a required persisted section. Select delivery using the skill's Return contract.

- **Outcome:** [delivery/outcome states, recommendation and outstanding approvals]
- **Deliverables:** [complete assigned Feature for `full_artifact`, including actual flows, criteria, open decisions and readiness; changed paths for `file_summary`; bounded findings for `assessment`]
- **Evidence:** [sources, actual acceptance/measurement results and limits versus proposed work]
- **Risks and blockers:** [remaining gaps, prerequisites and ready conditions]
- **Next owner:** [named owner or Unknown / proposed; exact decision, refinement or authorized execution action]
