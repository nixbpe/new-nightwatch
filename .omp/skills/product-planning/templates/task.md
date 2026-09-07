Template, not an approved product artifact

Apply the Entry protocol and Return contract in `skill://product-planning` before using this content shape; states, readiness and DoD also come from that skill. Template prompts do not authorize new work. Use `Unknown — [reason; how to resolve]` for missing facts; remove instructional placeholders and irrelevant optional fields. For review/editorial work, preserve the existing artifact rather than filling every section. Read-only roles return content to the parent; this template grants no persistence, approval or release authority.

# Task: [Bounded engineering work or learning]

Use only sections relevant to the chosen type. An implementation Task is engineering work, not an independently valuable user Story. Research work must not be disguised as a fake user Story.

## Controls and traceability

- ID: [existing ID, otherwise draft convention T-001; not a tracker ID]
- Current candidate / revision, when needed: [identity required by current approval/evidence; omit unnecessary revision lineage]
- task_type: [Implementation | Research | Spike | Enabler]
- Parent: [ID / actual path or supplied source, candidate when needed; Implementation → Story only; Research / Spike / Enabler → closest justified PDD, Epic, Feature or Story]
- Parent rationale: [for Research / Spike / Enabler, why this is the closest justified parent and the learning/unblock outcome; for Implementation, relevant Story acceptance refs]
- Missing ancestor links: [None, or exact missing links; never fabricate approved parents]
- delivery_status: [Draft | Refining | Ready | In Progress | Blocked | Done | Stopped]
- Owner: [named owner or Unknown / proposed owner, explicitly labeled]
- Evidence / decision references: [current sources, accepted scope, contracts and semantic decision/criterion refs, not question-round labels or review history; pending items labeled]

## Scope and intended result

- Objective: [engineering result contributing to Story acceptance, or bounded learning/unblock outcome]
- Scope: [included work and safe boundaries]
- Non-goals: [excluded behavior, changes and adjacent questions]
- Input / contract references: [current versions and acceptance refs; enclosing Feature is the requirements source when applicable]
- Unresolved decisions / risks: [impact, decision owner, resolution input or explicit risk-acceptance reference]

## Implementation ownership — Implementation only

Do not invent paths, assignments or technical contracts. Proposed ownership is not permission to edit. Ground the actual workspace, owned files and verification scope in the supplied assignment and inspected sources; ask the assigning parent only for genuinely missing execution authority or inputs. Preserve existing authorization without duplicate confirmation; report outside-scope needs rather than expanding edits.

- Assigned workspace / safe environment: [confirmed location and authorization reference, or explicitly proposed / Unknown]
- Approved behavior / technical decisions: [Story/Feature criterion refs and owner-approved versioned contracts; open decisions go to the owning engineer or Tech Lead]

| Owned file / bounded area | Confirmed or proposed | Assignment / ownership reference | Intended change / caller or contract effect |
| --- | --- | --- | --- |
| [inspected path or explicitly proposed new path] | [confirmed / proposed] | [parent assignment, or pending] | [bounded change; no unrelated refactor] |

- Ownership overlaps / outside-scope needs: [None, or exact areas and parent coordination needed]
- Safe verification scope: [authorized behavior, environment, fixtures and command restrictions; no production access assumed]

## Learning / unblock design — Research, Spike or Enabler only

- Bounded question or unblock need: [uncertainty or prerequisite being addressed]
- Method and safe scope: [research/experiment/enabling work, authorized sources/environment, population where applicable, data/privacy limits]
- Learning / unblock outcome: [observable evidence or capability needed by the parent; not “research complete”]
- Decision rules / stopping condition: [what supports, contradicts or leaves the question inconclusive; or proves the prerequisite usable]
- Limits and next decision: [what this work cannot establish; decision owner and how the evidence will be used]

Research readiness needs a bounded question, method and safe scope, not a finished PDD or implementation-ready Story. Research Done records observed learning evidence, including inconclusive findings against the exit condition; it does not mean a Feature was delivered.

## Execution plan versus observations

| Proposed step | Proposed command / method, only if needed | Required input / authorization | Expected observable exit |
| --- | --- | --- | --- |
| [bounded step within assigned scope] | [repository-grounded proposal; not executed evidence] | [real prerequisite or None] | [criterion / learning result] |

Do not invent dependencies, tools, services, credentials, deadlines or estimates. A proposed command is never a result and cannot override the role's tools or the parent's verification restrictions. Preserve current execution evidence needed for exit assessment; an editorial rewrite is not a new execution, and an unavailable environment does not prevent drafting this Task.

| Actually executed action / method | Safe context / date | Observed result / evidence ref | Limits, failures or unexercised paths |
| --- | --- | --- | --- |
| [Not executed, or actual action] | [actual context when known] | [actual output/source; never expected output copied as fact] | [what remains unproved] |

## Prerequisites, readiness and exit evidence

| blocked_by reference, or None | Actual prerequisite / affected work | Ready condition | Input owner / next action |
| --- | --- | --- | --- |
| [input, decision or item] | [why required before this work can proceed] | [observable condition] | [who supplies it] |

Parentage is containment, not an automatic dependency. A child may start while its parent is In Progress with its actual inputs ready. No role-order edges or cycles; missing links stay visible and future work may remain Draft.

- Ready assessment: [type-appropriate accepted scope, owner, actual inputs, safe method and verifiable exit; Implementation also needs confirmed ownership, needed contracts and relevant risk resolution/acceptance]
- Task-specific exit condition: [observable engineering result or bounded learning/unblock criterion]
- Exit evidence: [criterion → actual result/source refs, or not yet demonstrated]
- Common DoD evidence: [current acceptance; integrated behavior demonstrated for delivery work; required reviews/risk checks; known gaps honestly recorded; affected contracts/docs updated where needed]
- Parent follow-through: [Story integration/acceptance still needed, or research evidence and ensuing decision; Task Done alone never satisfies Story]

Evidence status remains separate from delivery; any `Validated` claim needs a bounded criterion actually met with source/date/population/method/limits. Approval is not evidence. Never pass DoD from absent results. Done ≠ released ≠ outcome achieved; DoD grants no release approval.

## Handoff

Response metadata, not a required persisted section. Select delivery using the skill's Return contract.

- **Outcome:** [delivery state and actual engineering result or observed learning, not an inferred release/outcome]
- **Deliverables:** [complete assigned Task for `full_artifact`; actual assigned changes/evidence paths for `file_summary`; bounded findings for `assessment`; relevant caller/contract impact without unauthorized edits]
- **Evidence:** [executed actions and observed results with limits, separate from proposed steps/commands]
- **Risks and blockers:** [remaining defects, unexercised paths, prerequisites and ready conditions]
- **Next owner:** [parent, QA or relevant named decision owner / Unknown / proposed; exact acceptance, integration or decision action]
