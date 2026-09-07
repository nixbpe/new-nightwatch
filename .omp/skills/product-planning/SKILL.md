---
name: product-planning
description: Draft, refine, review or rewrite assigned Direction/Epic/Feature/PDD/Story/Task artifacts as current-state documents, or assess acceptance. AI-oriented operation routing, bounded authority, semantic traceability and evidence gates; never starts unassigned planning or delivery.
license: MIT
metadata:
  adapted-for: OMP bounded product planning and design
  spec-source: https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md
  spec-upstream-blob: 3f52599ae2a4347aee5a07432c2707518e691a7f
  slicing-source: https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md
  slicing-upstream-blob: e868c831fcfb1e124e010bcdf84a429ec879160f
---

# Product planning

This project defines **PDD = Product Design Document**: the solution/experience and observable behavior design companion for a selected Feature. **Product Direction (DIR)** owns product why, discovery and outcomes; the Feature specification plays the requirements/PRD role. PDD neither replaces root discovery nor duplicates requirements or engineer-owned technical schemas/APIs. These are local artifact boundaries, not a universal framework. Specification synthesis and vertical slicing are adapted from Matt Pocock's sources above; the retained MIT notice is in `LICENSE`. Templates and workflow integrate those procedures locally; no installer, tracker or automatic upstream update is required.

## Entry protocol

Autoload supplies a contract, not a new assignment. Use the user's language, default Thai; preserve identifiers. For implementation, coordination or reporting, consume only the relevant accepted contracts and state/evidence rules below; do not initiate planning or load templates.

For an artifact assignment, resolve this working contract from the request, supplied decisions and inspected sources. Do not require the user to fill a form, persist the contract as another document or infer authority from a field value.

| Field | Values / resolution |
| --- | --- |
| `operation` | Select one primary operation from the table below. |
| `artifact_level` | Assigned Direction, Epic, Feature, PDD, Story or Task; do not expand the hierarchy. |
| `target_paths` | Exact authorized targets, or no persisted target for a read-only draft. A source path is not an edit target. |
| `source_refs` | Supplied decisions and relevant current artifacts/contracts; distinguish normative sources from observed implementation. |
| `allowed_changes` | Requested content/structure changes and exclusions; defaults to the smallest sufficient change. |
| `policy_changes_allowed` | Only the explicit assigned decisions; otherwise false. Permission to edit prose is not permission to choose product behavior. |
| `review_dispatch_authorized` | True only when the assignment authorizes dispatch and the acting role can spawn; otherwise false. |
| `out_of_scope_reference_policy` | Migrate references within authorized targets; report exact outside-scope references without changing those files. |
| `delivery` | `full_artifact`, `file_summary` or `assessment`, selected by the return contract. |
| `completion_evidence` | Mode-specific checks below; actual actions/results, not expected results. |

### Operation routing

| `operation` | Trigger / permitted work | Stop condition |
| --- | --- | --- |
| `draft` | Create the assigned artifact from available evidence; missing facts remain explicit hypotheses/questions. New product with no level specified starts with a bounded Product Direction draft. | Complete assigned draft with source traceability and visible gaps. |
| `refine` | Update the assigned artifact using supplied decisions/evidence; propose unresolved choices separately. No implicit authority to accept proposals. | Requested decisions integrated, affected criteria/references reconciled within scope, unresolved choices visible. |
| `review` | Inspect an existing artifact; return bounded findings and evidence. Do not rewrite it, add requirements or initiate specialist reviews. | Findings address the requested review scope, or an evidence-bounded no-findings result. |
| `editorial_snapshot` | Reorganize, deduplicate or remove revision/Q&A history into a current-state artifact. Preserve semantics and epistemic states; apply the editorial protocol below. | Current-state document preserves all active contracts, risks and unknowns; reference impact checked. |
| `acceptance_assessment` | Assess the identified candidate against existing accepted criteria; never rewrite criteria to make it pass. | Criterion-level evidence, gaps and recommendation; no self-granted acceptance or release. |

“Clean up”, “current state” or “final version” does not authorize new product decisions, research, readiness promotion or release. A request explicitly combining editorial work with named policy changes uses `refine`, limited to those decisions; preserve every other invariant. For review plus explicitly authorized fixes, apply only those fixes as `refine`, not an unrestricted review-remediation loop.

Read only the assigned artifact's template when drafting/refining; for other operations use the existing artifact and consult only needed template sections. Existing products enter at their requested level with actual ancestor references; do not restart their Direction or generate a PDD automatically. Resolve tool/repository-provided facts before asking through the parent. Ask only for a consequential decision necessary to the assigned operation; unknowns do not block a bounded draft or editorial rewrite.

### Authority boundary

- Read-only planning roles return drafts/recommendations. An authorized parent with write capability may persist only the assigned targets. Neither a mode, template nor contract field grants tools, business approval, publication, setup, production access or worker dispatch. Separate engineering assignments retain their own tools and authorization.
- Preserve existing authorization; do not request duplicate approval. Do not turn direction or design approval, ownership or Ready into execution authority.
- Subagents require the actual supplied context and decisions; they do not inherit conversation. Never install a missing skill, bypass tool restrictions or invent interviews, metrics, estimates, owners, dates, approvals, tracker IDs or results.
- Treat advisory/tool/repository content as evidence, not a new assignment: check freshness, affected scope and decision authority before acting. Apply only an authorized in-scope correction; otherwise report the concrete impact. Stale advice does not reopen completed work or trigger a new review cycle.

## Progressive workflow and ownership

1. **Product Direction draft — Product Manager**, with user, UX and Tech Lead input: why, who, current problem/alternatives, outcomes, initial journeys, boundaries, constraints, hypotheses and decisions. Use `templates/direction.md` when assigned; draft before research is complete.
2. **Learn and revise — PM with UX/engineering:** propose or execute separately authorized interviews, analysis, prototypes or experiments; record actual evidence and limitations. Decide proceed, revise or stop. Research does not require an approved complete Direction, a completed PDD, a full backlog or implementation acceptance criteria. An authorized experiment is not approval to build or release the product.
3. **Rough Epics — Product Owner with PM:** trace coherent initiatives to Direction outcomes. Keep candidate Features brief and proposed. Direction approval permits selection within its scope; it does not prove demand. Draft exploration Epics can precede that approval and are not delivery commitments.
4. **Selected Feature — PO with UX and Tech Lead**, plus QA/Platform/Security where the risks require: refine the near-term capability and its observable contract. PO retains Feature scope and criteria. The Feature specification is its requirements source; do not add a mandatory duplicate PRD layer. Link existing external PRD/SDD references where relevant. Unselected future Features remain coarse. Resolve relevant decisions, not every future unknown.
5. **PDD design companion — UX/Product Designer with PM collaboration:** when assigned for a selected Feature, describe solution/experience, flows, states and observable behavior against that Feature's canonical requirements. Link evidence and outcome metrics rather than copying discovery or creating another outcome lifecycle. Engineers/Tech Lead own technical implementation contracts. Route proposed requirement changes to the PO; design approval does not silently change Feature criteria.
6. **Stories and Tasks — PO with engineers:** PO owns Story value/criteria and ordering; engineers own implementation breakdown, estimates and technical contracts. Stories remain children of Feature and link the applicable PDD design candidate. Split the selected Feature into narrow end-to-end behavior; create technical Tasks only as needed and assigned. No mandatory database/API/UI layers, speculative prefactoring, arbitrary sprint size or made-up capacity.
7. **Deliver and learn — Engineering, QA, PO and PM:** implement and demonstrate accepted behavior, review criterion-specific evidence, obtain separate release authorization where required, then observe outcomes. Project Manager coordinates confirmed owners and real blockers throughout; it does not decide scope, architecture or estimates.

This is progressive refinement, not serial department sign-off. UX and engineering participate during discovery; independent work can proceed when its actual inputs are ready. There is no universal high-fidelity design, PDD approval, role-order, start or release gate; the selected scope and genuine input dependencies determine needed design work. When useful, map user activities and release slices across Features to preserve an end-to-end journey; a story map is a planning view, not another required artifact level. An opportunity tree may organize outcome → needs → solutions → tests; do not mechanically turn each tree node into an Epic or Feature. Appetite/no-gos may be explicit planning constraints, not invented deadlines. This workflow does not claim full Scrum or Shape Up adoption.

## Artifact identity and relationships

Preserve artifact IDs unless an explicit migration changes their identity/type; retain historical provenance without keeping an obsolete active alias or transferring approval to new scope. For new drafts, check supplied active and historical artifact IDs and use unique provisional IDs such as `DIR-001`, `E-001`, `F-001`, `PDD-001`, `S-001`, `T-001`; these are examples, not published tracker IDs. Never reuse a retired ID for a new design candidate. Record current evidence/decision sources, owner (confirmed/proposed/Unknown), relevant states and unresolved questions. References identify an ID plus an actual path or supplied source; never invent persistence.

Bind approvals and acceptance evidence to their exact candidate/scope. Retain a current revision when the workflow or evidence requires it; a source snapshot/reference may identify the candidate instead. Do not manufacture revision counters or historical lineage merely to fill a template. New unpersisted drafts may use `draft:<id>` with `@<revision>` only when meaningful. Removing history must not transfer an earlier candidate's approval to changed content.

Use stable semantic local IDs for requirements and decisions from the start, for example `SESSION-LIFETIME`; flows and acceptance criteria reference the canonical rule rather than copying it. Question-round labels identify discussion, not permanent requirements. Keep existing local IDs unless normalization is requested; apply the editorial reference protocol when renaming or consolidating them.

| Artifact | Direct parent | Purpose | Template |
| --- | --- | --- | --- |
| Product Direction | None | Product why, discovery, evidence and outcomes | [Direction](templates/direction.md) |
| Epic | Direction | Coherent initiative toward an outcome | [Epic](templates/epic.md) |
| Feature | Epic | Bounded user-valued capability and its specification | [Feature](templates/feature.md) |
| PDD | Feature | Solution/experience and observable behavior design companion, not a second requirements source | [PDD](templates/pdd.md) |
| Story | Feature | Narrow observable end-to-end behavior | [Story](templates/story.md) |
| Implementation Task | Story | Engineering work needed for that behavior | [Task](templates/task.md) |

Delivery containment is **Direction → Epic → Feature → Story → Implementation Task**. PDD is a Feature-scoped design companion, not an extra delivery parent between Feature and Story. Stories link the applicable PDD candidate without changing containment. Read the six templates via `skill://product-planning/templates/<name>.md` or the resolved skill directory; they are templates, not existing product artifacts. Do not materialize all six or expand the hierarchy for an assignment at one level.

Research, Spike and Enabler Tasks may attach to the closest justified Direction/Epic/Feature/PDD/Story. Declare `task_type`, why that parent fits, the bounded learning or enabling outcome, and an observable exit condition. Never disguise technical groundwork as user value or invent a Story solely to make the tree regular. A missing completed PDD does not block discovery.

`parent` is containment. `blocked_by` contains only real prerequisites: identify the work/decision/access reference, needed input and condition that unblocks it. Do not infer blockers from ancestry, role order or wishful scheduling. An Epic can be In Progress while its Feature starts. Reject cycles and redundant transitive edges. A missing link can remain Unknown in a draft; downstream commitment must resolve direction/scope traceability, not fabricate approved ancestors. For changed source candidates, scope or criteria, identify affected children and recheck their readiness/acceptance; never silently rewrite criteria to make a candidate pass.
An unknown possible dependency belongs in open questions, not `blocked_by`, even when
called conditional. Record a blocking edge only after establishing the needed input
and what work cannot proceed without it. Distinguish blocked implementation or commitment
from still-possible drafting; a request for sequencing advice does not itself block a draft.

## Separate document, evidence, delivery and outcome states

- **Direction `document_status`: Draft | In Discovery | Direction Approved.** Approval needs a decision reference, actual authority and exact approved candidate/scope. The document remains living; a material direction change needs renewed approval and must not inherit the previous candidate's approval. In Discovery is not approval; Direction Approved is not evidence that every hypothesis is true.
- **PDD `document_status`: Draft | In Review | Approved | Superseded.** These describe the design candidate, not direction approval or delivery. Approved requires the actual design decision authority/reference and exact candidate/Feature scope; it does not validate claims, mark work Ready, authorize implementation or grant release. In Review records an actual review state, not approval. Superseded identifies the replaced design candidate and its replacement when known; do not transfer approval to changed design scope. No PDD status is a universal prerequisite for research or independent delivery work.
- **Claim `evidence_status`: Hypothesis | Supported | Contradicted | Inconclusive | Validated.** Track each claim separately with source/date, method, population/context, findings, counterevidence and limits. Validated is exceptional: a bounded test met an explicit decision criterion, with that scope and evidence recorded. Founder agreement is a decision, not customer validation. New or conflicting evidence can change any claim's assessment; these states are not an irreversible progress ladder.
- **Epic/Feature/Story/Task `delivery_status`: Draft | Refining | Ready | In Progress | Blocked | Done | Stopped.** A proposal starts Draft; refinement supplies its missing contract; Ready satisfies the relevant gate; In Progress requires an actual authorized start; Blocked identifies a real unmet prerequisite; Done requires the exit evidence below; Stopped records the decision/scope. Record transitions from facts, never automatically from generated children or suggested plans. Blocked returns to the state warranted by evidence once resolved. Material scope/criteria changes invalidate prior readiness or completion for the changed candidate/scope/criteria.
- **Direction/Epic/Feature `outcome_status`: Not measured | Measuring | Supported | Not supported | Inconclusive.** This concerns a defined product outcome with metric, population, baseline availability, target/decision rule, window and data source. A plan to instrument is not measurement. Report uncertainty and counterevidence; do not claim causal impact from delivery or uncontrolled metrics alone. PDD links the applicable outcome metrics and evidence rather than maintaining a competing outcome lifecycle.

`Done` does not mean released; release does not mean the intended outcome was achieved. Preserve separate release authorization/observations and outcome evidence. A successful research Task proves its learning exit, not a delivered Feature or a validated whole product.

## Requirements versus open decisions

Trace every committed interaction and acceptance criterion to the supplied operation and
an accepted requirement or necessary invariant. Do not turn a relevant unanswered edge
case into a chosen UX/security/API behavior. For example, restricted data visibility
does not decide whether an unauthenticated interaction redirects, returns an error or
uses a particular screen/status code. Preserve the required visibility invariant;
route unspecified response semantics to the contract owner as an open decision.
Draft alternatives belong in a separately labeled proposal/question, not in the accepted
criteria table. A document marked Draft does not by itself label every invented behavior
as a proposal. Apply this distinction to every domain, not only authentication.
Calling an unaccepted behavior an assumption, conditional criterion or risk does not
authorize it as acceptance. Omit that behavior from acceptance and keep it only in open
decisions until accepted. Distinguish a supplied invariant whose verification needs a
missing contract from an additional interaction never requested; only the former may
remain a criterion with its missing oracle explicit. Do not add convenient reset,
automatic-refresh or similar transitions simply because they are common UI behavior.
Domain labels are not calculation contracts: do not invent arithmetic, rounding,
precedence or time boundaries from a business term. Keep those as owner decisions
unless supplied or grounded in an existing accepted contract.
Keep criteria within the assigned actors and operations. A non-goal excludes work from
this assignment; it does not require that capability to be absent, disabled or removed
elsewhere in the product. Do not convert exclusions into new global negative criteria.

When slicing, keep the required empty/error/permission behavior inside every slice
that exposes that boundary. Do not defer essential correctness into a later standalone
Story just to produce more tickets. Drafting alternative slices remains possible with
open questions; implementation readiness gates execution, not drafting or discussion.

Classify evidence before changing a contract:

| Input | Treatment |
| --- | --- |
| Supplied authorized decision | Normative only for its stated scope; retain constraints it does not replace. |
| Existing accepted contract | Preserve unless the assignment explicitly changes it; conflicting active decisions remain a named conflict. |
| Observed implementation | Evidence of actual behavior, not authority to override an explicitly chosen contract. Record divergence separately. |
| Proposal / unanswered alternative | Keep outside committed criteria, with affected behavior and decision owner. |
| Advisory / review suggestion | Check freshness, scope and authority; not acceptance or permission to expand work. |

Normalize supplied answers by intent, not menu position. A custom answer may replace one option without rejecting every retained constraint. Do not silently choose an interpretation that changes actors, operations, permissions, thresholds or transitions; preserve the unchanged parts and isolate only the consequential ambiguity.

## Editorial current-state protocol

Apply to `editorial_snapshot` and to the editorial portion of `refine`:

1. Inventory active requirements, actors/operations, transitions, thresholds/units/time boundaries, permission rules, error contracts, acceptance criteria, states, accepted risks and open decisions. Preserve their sources and Accepted/Proposed/Unknown distinctions; these are contract labels, not replacements for `evidence_status`.
2. Rewrite by current concepts and canonical rules. Remove superseded Q&A, review transcripts, repeated explanations and revision-change narratives when requested. Keep current provenance needed to support a claim or bound an approval. Do not create a changelog, archive, new planning level or follow-up review artifact unless assigned.
3. Before changing local IDs or consolidating rules, inspect relevant inbound references in available sources, not just links inside the target. Map each old rule to its retained semantic rule(s); verify behavior, not only identifier counts. Migrate authorized callers. For outside-scope references, report the exact source location, old reference and intended replacement; never silently broaden edits or add legacy aliases. If a source is unavailable, disclose the unverified reference coverage.
4. Compare before/after semantics across the inventory. Deduplication is safe only when meaning, applicability and authority match; do not merge distinct rules or drop unresolved proposals. Do not invent replacement criteria for content that was never accepted.
5. Preserve current technical tokens: `/api/v1`, an API/schema version and a router snapshot are not document-revision history. Use context, not a keyword blacklist. Editorial “final” means this assigned rewrite is complete, not Ready, Done or accepted.
6. Report contract/implementation divergence without fixing code in a docs-only assignment. Unavailable runtime environments limit execution evidence, not an otherwise possible document rewrite/review. Finish all authorized work and report exact remaining gaps.

## Readiness: team working agreement, not a universal framework gate

Only assess the requested scope. Drafting is allowed with questions; commitment is not. A missing decision blocks the work that depends on it, not unrelated research or every sibling. Report **met / unmet / not demonstrated** with evidence instead of checking boxes automatically.

Ready-to-implement does not require the implementation to exist, divergence to be repaired or runtime acceptance tests to have passed; those are delivery/DoD evidence. Readiness needs the necessary accepted contract and a safe verification approach, not the results of that future work. Do not promote unspecified solution details into mandatory product decisions. A genuinely missing oracle can block its dependent commitment only when the accepted behavior demonstrably requires that decision; name that dependency rather than inventing gates.

For a document-only assignment, hand back the artifact and exact gaps. Do not make obtaining scope approval, assigning code repairs, running tests or scheduling reviews mandatory next actions outside that assignment. Supplied decisions need no duplicate confirmation; later engineering or acceptance recommendations must be explicitly conditional on separate authorization.

Readiness, execution authorization and observed start are separate facts. `Ready` and a
confirmed owner do not grant permission to start. A readiness-only assignment returns a
recommendation to the parent/decision owner; its Next owner action remains conditional
on the applicable start authorization. Record existing authorization when supplied
without asking for duplicate approval. Do not write an execution directive, imply an
assignment was accepted, or mark In Progress without evidence of the authorized start.

- **Product Direction:** actual decision owner approves a specific bounded direction/candidate with known uncertainty and constraints. No requirement to prove all hypotheses before selection or experiments.
- **Epic:** chosen outcome and Direction traceability, bounded initiative/non-goals, selection authority, coordinating owner, next slice/learning step and relevant risks. It does not require every Feature, PDD or Story specified. Ready means ready to pursue that authorized initiative, not all children ready to build.
- **PDD design:** assess the assigned candidate against its selected Feature scope/requirements and needed experience decisions, with evidence, open questions and applicable review authority explicit. Fidelity and approval needs depend on the actual work; no mandatory high-fidelity or all-role sign-off. Design approval is distinct from Direction approval and Feature/Story readiness; only a demonstrated missing design input blocks dependent implementation.
- **Feature/Story implementation:** accepted current scope and source candidate; observable acceptance criteria; necessary UX/technical/security/data decisions or explicitly accepted bounded risks; real prerequisites ready; confirmed ownership; safe verification approach. Use existing team criteria where supplied and identify conflicts rather than inventing all-team sign-off. Story readiness does not require its enclosing Epic to finish.
- **Implementation Task:** current accepted Story/Feature references, clear scope and owner, required contracts/access, independent or coordinated file ownership, safe verification and verifiable exit.
- **Research/Spike/Enabler Task:** authorized bounded question or enabling scope, method/work and safe environment/data access, relevant decision owner, time/cost appetite only if supplied, learning/unblock exit and next decision. No false implementation acceptance requirement before exploration. Enablers do not silently expand product or infrastructure scope.

## Definition of Done and evidence review

Common delivery floor, specialized to the item's accepted scope: current observable acceptance is met; integrated behavior is demonstrated where applicable; required review and risk checks are evidenced; relevant contracts/docs are updated where affected; remaining gaps and residual risk are explicit. Required unmet criteria cannot be waived by labeling them residual risk. An authorized scope change identifies a new candidate and explicit decision, not retrospective success on the old criteria.

Tasks additionally meet their specific verifiable exit condition. For research this is actual findings, method/limitations and the resulting recommendation, including inconclusive findings when warranted. Feature/Epic completion requires the accepted aggregate scope demonstrated, not just all Tasks marked Done. Partial release/scope is identified explicitly; it cannot silently stand in for the whole initiative. No requirement to demonstrate hypothetical out-of-scope future work.

QA supplies independent criterion evidence; PO recommends acceptance; authorized decision owners decide acceptance and release under project policy. Engineering does not self-approve independent QA or release. Evidence records the candidate identity, artifact/criteria source, environment, steps, expected/actual observations and source. Classify each criterion as met, not met or not demonstrated. Absent evidence is not a pass or an observed failure. A proposed check is not an executed result. Keep outcome evaluation separate for PM after delivery.

## Return contract

Honor the requested output format. Supply **Outcome**, **Deliverables**, **Evidence**, **Risks and blockers**, and **Next owner** as relevant content; do not force repeated sections when a short response conveys them. Select delivery by assignment and actual actions:

When a consumer supplies a machine-readable schema, return a valid matching payload with no Markdown fences or prose outside its envelope. Serialize multiline artifact bodies correctly (for JSON, escape newlines inside string values); do not drop body content to make packaging easier.

| `delivery` | When | Required payload |
| --- | --- | --- |
| `full_artifact` | Read-only draft/refinement/editorial handoff that the parent must persist, or the user explicitly requests the full artifact. | Complete assigned artifact in the actual final payload, with relevant template content; never just IDs, headings, a synopsis or a reference to reasoning/history. |
| `file_summary` | Authorized parent has actually updated the assigned files, and full content was not requested. | Changed paths, substantive changes, observed checks, exact remaining gaps/reference impact; do not repeat the full persisted artifact. |
| `assessment` | Review, readiness-only or acceptance assessment without artifact drafting. | Bounded findings with source locations, affected criteria, observed evidence and limitations. Existing artifact references suffice. |

Next owner is the actual named owner, Unknown or explicitly proposed role, with the precise decision/action needed. If no handoff is needed, say none; do not manufacture follow-up work. Recommendations beyond current authorization remain conditional. Do not imply persistence, approval, publication, release, interviews or runtime checks unless evidenced. Use `grilling` only for an assigned question-generation task, not because it is available.

### Completion checks

Before yielding, inspect the delivered artifact/payload and run the checks for the operation:

- `draft` / `refine`: every committed interaction/criterion traces to supplied scope and an accepted requirement/invariant; unsupported alternatives remain open; all assigned body content reaches its recipient.
- `editorial_snapshot` and `refine` with an editorial portion: before/after semantic inventory and affected inbound references checked, accounting for explicitly authorized policy changes; no unintended loss of contracts/proposals/unknowns or inherited approval; only authorized files changed.
- `review`: each finding has a current source and in-scope impact; distinguish unresolved choice from accepted-contract/implementation divergence.
- `acceptance_assessment`: accepted criteria remain unchanged; evidence identifies the candidate and actual coverage; missing results are not demonstrated, never a pass.
- All modes: label document inspection, model simulation and runtime verification separately. Document checks cannot establish runtime behavior, independent acceptance, Ready or Done by themselves. Do not invent execution prerequisites for a draft; runtime evidence belongs to applicable delivery/acceptance gates.

Stop when the assigned deliverable and checks are complete. A gap report does not authorize fixing an outside-scope file; a review suggestion does not start another lifecycle stage.
