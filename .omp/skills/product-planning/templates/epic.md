Template, not an approved product artifact

Apply the Entry protocol and Return contract in `skill://product-planning` before using this content shape; states, readiness and DoD also come from that skill. Template prompts do not authorize new work. Use `Unknown — [reason; how to resolve]` for missing facts; remove instructional placeholders and irrelevant optional fields. For review/editorial work, preserve the existing artifact rather than filling every section. Read-only roles return content to the parent; this template grants no persistence, approval or release authority.

# Epic: [Outcome-oriented title]

## Controls and traceability

- ID: [existing ID, otherwise draft convention E-001; not a tracker ID]
- Current candidate / revision, when needed: [identity required by current approval/evidence; omit unnecessary revision lineage]
- Parent PDD: [ID / actual path or supplied source; exact candidate when approval depends on it; missing link explicitly reported, never fabricated]
- delivery_status: [Draft | Refining | Ready | In Progress | Blocked | Done | Stopped]
- outcome_status: [Not measured | Measuring | Supported | Not supported | Inconclusive]
- Owner: [named owner or Unknown / proposed owner, explicitly labeled]
- Evidence / decision references: [semantic claim/decision IDs and current sources, direction decision and bounded scope; pending approvals labeled; not a Q&A/review timeline]

Parentage is containment, not an automatic `blocked_by` edge. A child may start while its parent is In Progress when its actual inputs are ready. Missing ancestors remain visible gaps; do not invent approved parents or treat draft IDs as filed work.

## Target outcome and boundaries

- Users / problem: [bounded part of the PDD problem; evidence refs]
- Target outcome: [observable change and how this Epic contributes to the PDD outcome]
- Supporting and contrary evidence: [refs with evidence status from the PDD/register; separate observation from hypothesis]
- Scope: [capability or problem boundaries, not a complete implementation plan]
- Non-goals: [excluded users, behaviors or approaches and rationale]
- Constraints / risks: [relevant sourced limits, uncertainty, response and owner; accepted risk needs decision ref]

| Outcome metric / population / window | Baseline and source | Target / acceptance of target | Measurement and owner | Guardrails / observed outcome refs |
| --- | --- | --- | --- | --- |
| [definition and unit] | [known value + date, or Unknown + collection plan] | [proposal or actual decision ref] | [method / instrumentation needed] | [limits; Not measured if not observed] |

Evidence status is not delivery status or outcome status. `Validated` evidence requires a bounded criterion actually met with source/date/population/method/limits; direction approval alone never qualifies.

## Rough Feature candidates and selection

Keep candidates rough. Detail only selected near-term Features in their Feature specs when assigned; do not generate Stories or Tasks automatically. Candidate selection is a recommendation unless a decision reference records acceptance.

| Candidate / existing or draft reference | User behavior / contribution to outcome | Evidence and uncertainty | Selected / deferred / rejected / undecided | Rationale, trade-off and decision ref |
| --- | --- | --- | --- | --- |
| [candidate title or reference; no fake tracker ID] | [bounded capability, not a layer task] | [refs; unanswered question] | [recommendation or recorded decision] | [why this candidate now / not now] |

- Sequencing rationale, if needed: [actual input dependencies and learning priorities; no invented dates, estimates or role-order gates]
- Next learning, if needed: [bounded question, safe method, owner and evidence that enables selection]

## Dependencies, readiness and completion

| blocked_by reference, or None | Actual prerequisite / affected work | Ready condition | Input owner / next action |
| --- | --- | --- | --- |
| [input, decision or item] | [why required before this work can proceed] | [observable condition] | [who supplies it] |

No cycles or automatic parent/role-order dependencies. A draft candidate is not a commitment.

- Readiness assessment for the assigned next step: [direction/scope acceptance refs, outcome intent, owner, relevant risks and actual inputs; remaining gaps rather than automatic Ready]
- Completion evidence: [current acceptance refs; integrated behavior demonstrated; required reviews/risk checks; known gaps; affected contracts/docs updated where needed]
- Release and outcome: [separate release decision/evidence if applicable and observed outcome refs; Done ≠ released ≠ outcome achieved]

Only claim Done against the canonical DoD with actual evidence, never from child Task counts or missing results. Discovery work records observed learning, not a delivered Feature.

## Handoff

Response metadata, not a required persisted section. Select delivery using the skill's Return contract.

- **Outcome:** [recommendation, delivery/outcome states and unapproved decisions]
- **Deliverables:** [complete assigned Epic for `full_artifact`; changed paths for `file_summary`; bounded findings for `assessment`; rough candidates / selected Feature references only as assigned]
- **Evidence:** [sources, counterevidence, actual observations and limits versus proposed work]
- **Risks and blockers:** [remaining gaps, prerequisites and ready conditions]
- **Next owner:** [named owner or Unknown / proposed; exact selection, research or refinement action]
