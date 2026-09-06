Template, not an approved product artifact

Read `skill://product-planning` for canonical states, readiness and Definition of Done (DoD). Use `Unknown — [reason; how to resolve]` for missing facts. Replace or remove instructional placeholders; never copy unanswered prompts as final factual requirements. Return drafts to the parent; this template grants no authority to persist, approve, file or release anything.

# Story: [Small end-to-end observable behavior]

A Story is a user-observable slice, not a technical layer or an implementation Task renamed as user value. Detail only selected near-term Stories. The parent Feature spec remains the single requirements source; reference its rules, flows and criteria instead of maintaining a duplicate spec.

## Controls and traceability

- ID: [existing ID, otherwise draft convention S-001; not a tracker ID]
- Revision: [current revision and material change]
- Parent Feature: [ID / path / revision and relevant flow/rule/acceptance refs]
- Missing ancestor links: [None, or exact gaps in Feature → Epic → PDD traceability; never fabricate approved parents]
- delivery_status: [Draft | Refining | Ready | In Progress | Blocked | Done | Stopped]
- Owner: [named owner or Unknown / proposed owner, explicitly labeled]
- Evidence / decision references: [support, counterevidence, slice selection and current scope decisions]
- Feature outcome contribution: [parent outcome/measurement ref; no separate Story outcome-status system]

## Behavior and boundaries

- Actor / context: [who, when and under which relevant permissions or conditions]
- Behavior and value: [what the actor can accomplish end to end and why it matters]
- Scope: [small complete slice through only the layers actually needed]
- Non-goals: [adjacent behavior or technical work excluded]
- Current scope acceptance: [decision owner, exact revision/scope and reference; otherwise pending]
- Needed UX / contracts: [current approved Feature/design/technical contract references or unresolved input and owner; do not invent technical decisions]

## Acceptance and safe verification

Use observable results and relevant failure, permission or recovery boundaries. Story criteria select/refine the parent Feature behavior; any changed Feature requirement must be reconciled with that source by its owner, not silently forked here.
Do not choose unspecified UX/security/API response semantics as acceptance criteria.
Keep alternatives as labeled proposals/questions for the contract owner, even in a draft.

| Story acceptance ref / Feature criterion refs | Given / action or event | Observable expected result | Safe method / fixture / verification owner | Actual result evidence, when exercised |
| --- | --- | --- | --- | --- |
| [criterion] | [bounded setup and action] | [measurable behavior, not a code task checklist] | [authorized environment and data; method] | [Not exercised, or result ref and limits] |

- Integrated demonstration: [how the whole slice will be exercised, including relevant contracts/boundaries; proposed until observed]
- Verification restrictions: [unsafe/unavailable environments, data or access; exact missing prerequisite and safe alternative if justified]

## Risks, blockers and readiness

| Risk / unresolved question | Affected criterion | Resolution or explicitly accepted risk reference | Owner / next action |
| --- | --- | --- | --- |
| [relevant uncertainty] | [observable effect] | [pending input or recorded acceptance] | [name or Unknown / proposed] |

| blocked_by reference, or None | Actual prerequisite / affected work | Ready condition | Input owner / next action |
| --- | --- | --- | --- |
| [input, decision or item] | [why required] | [observable condition] | [who supplies it] |

Parentage is containment, not an automatic blocking edge. This Story may start while its Feature is In Progress when actual inputs are ready; no role-order edges or cycles.

- Ready assessment: [evidence for accepted current scope, observable criteria, needed UX/contracts, resolved or explicitly accepted relevant risks, ownership and safe verification]
- Missing readiness inputs: [None with evidence, or exact gap and ready condition; future work may remain Draft]

## Small Task references — only if assigned

Do not decompose every Story automatically. Implementation Tasks are engineering work under this Story, not independently valuable user Stories; Research/Spike/Enabler Tasks follow the canonical parent exception with explicit rationale.

| Task ID / path / revision | Type / bounded work | Contribution to Story criteria | Owner / task exit evidence reference |
| --- | --- | --- | --- |
| [existing or draft reference; not a tracker claim] | [assigned work only] | [criterion refs or learning/unblock outcome] | [named or Unknown / proposed; result if observed] |

## Completion

- Current acceptance results: [criterion → actual result refs, failures and unexercised paths]
- Integrated behavior evidence: [observed whole-slice demonstration, not Task counts]
- Required reviews / risk checks: [applicable checks and actual results / accepted limits]
- Known gaps and affected contracts/docs: [honest gaps; updates made where needed and refs]
- Release separation: [any independent release decision ref, if relevant; Done ≠ released ≠ outcome achieved]

All implementation Tasks being Done does not satisfy this Story. Apply the common DoD floor to actual behavior; absent evidence cannot pass and DoD does not self-grant release approval.

## Handoff

- **Outcome:** [delivery state and behavior actually delivered, or draft recommendation]
- **Deliverables:** [complete assigned Story drafts in this final response/payload: identity/revision, parents, behavior, actual criteria, open decisions, blockers and readiness; not only a summary or IDs; Task references only if assigned]
- **Evidence:** [sources, actual acceptance/integration results and limits versus proposed work; evidence status stays separate]
- **Risks and blockers:** [remaining gaps, prerequisites and ready conditions]
- **Next owner:** [named owner or Unknown / proposed; exact refinement, implementation, review or decision action]
