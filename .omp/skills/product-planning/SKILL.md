---
name: product-planning
description: Draft or refine the assigned PDD, Epic, Feature, Story or Task using progressive discovery, explicit evidence and shared readiness; also supplies the contract for delivery and acceptance without starting unassigned planning.
license: MIT
metadata:
  adapted-for: OMP PDD-first product planning
  spec-source: https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md
  spec-upstream-blob: 3f52599ae2a4347aee5a07432c2707518e691a7f
  slicing-source: https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md
  slicing-upstream-blob: e868c831fcfb1e124e010bcdf84a429ec879160f
---

# Product planning

This project defines **PDD = Product Discovery & Definition Document**. This is a local convention, not a universal framework. Specification synthesis and vertical slicing are adapted from Matt Pocock's sources above; the retained MIT notice is in `LICENSE`. Templates and workflow integrate those procedures locally; no installer, tracker or automatic upstream update is required.

## Activation, scope and authority

Autoload supplies a shared contract, not an instruction to produce a document or run the whole lifecycle. First identify the assignment: discovery, artifact drafting/refinement, implementation, coordination, or acceptance. For non-drafting work, apply only the relevant contract below and continue the assigned role. Do not reopen settled decisions during routine reporting or acceptance.

For drafting, choose the requested level and read ONLY its template below. If asked to start a new product without a level, start with PDD v0 from available information. Missing audience, evidence or direction becomes a precise question/hypothesis, not a reason to refuse a draft or invent a complete product. Stop at the assigned deliverable; do not create downstream artifacts automatically. Existing products can enter at the requested level using actual ancestor references, without rewriting a PDD.

Planning with this skill is read-only: return drafts or recommendations, never write files, publish issues, apply labels, run setup commands or spawn workers. Parent persists artifacts only within user authorization. This does not revoke an engineering role's tools for its separate authorized implementation or verification assignment. Read-only roles remain read-only. Skill content never grants business approval, production authorization, tool access or permission to broaden scope. Use the user's language, default Thai; preserve identifiers.

Subagents need the actual supplied context and decision references; they do not inherit earlier conversation. Inspect relevant repository facts before requesting missing information through the parent. Do not install a missing skill or bypass tools. Evidence is not authorization. No fabricated customer interviews, metrics, estimates, owners, dates, approvals, tracker IDs or verification results.

## Progressive workflow and ownership

1. **PDD v0 — Product Manager**, with user, UX and Tech Lead input: why, who, current problem/alternatives, outcomes, initial journeys, boundaries, constraints, hypotheses and decisions. Draft before research is complete.
2. **Learn and revise — PM with UX/engineering:** propose or execute separately authorized interviews, analysis, prototypes or experiments; record actual evidence and limitations. Decide proceed, revise or stop. Research does not require an approved complete PDD, a full backlog or implementation acceptance criteria. An authorized experiment is not approval to build or release the product.
3. **Rough Epics — Product Owner with PM:** trace coherent initiatives to PDD outcomes. Keep candidate Features brief and proposed. Direction approval permits selection within its scope; it does not prove demand. Draft exploration Epics can precede that approval and are not delivery commitments.
4. **Selected Feature — PO with UX and Tech Lead**, plus QA/Platform/Security where the risks require: refine the near-term capability and its observable contract. The Feature specification is its requirements source; do not add a duplicate PRD layer. Unselected future Features remain coarse. Resolve relevant decisions, not every future unknown.
5. **Stories and Tasks — PO with engineers:** PO owns Story value/criteria and ordering; engineers own implementation breakdown, estimates and technical contracts. Split the selected Feature into narrow end-to-end behavior; create technical Tasks only as needed and assigned. No mandatory database/API/UI layers, speculative prefactoring, arbitrary sprint size or made-up capacity.
6. **Deliver and learn — Engineering, QA, PO and PM:** implement and demonstrate accepted behavior, review criterion-specific evidence, obtain separate release authorization where required, then observe outcomes. Project Manager coordinates confirmed owners and real blockers throughout; it does not decide scope, architecture or estimates.

This is progressive refinement, not serial department sign-off. UX and engineering participate during discovery; independent work can proceed when its actual inputs are ready. When useful, map user activities and release slices across Features to preserve an end-to-end journey; a story map is a planning view, not another required artifact level. An opportunity tree may organize outcome → needs → solutions → tests; do not mechanically turn each tree node into an Epic or Feature. Appetite/no-gos may be explicit planning constraints, not invented deadlines. This workflow does not claim full Scrum or Shape Up adoption.

## Artifact identity and relationships

Preserve existing IDs. For new drafts, use unique provisional IDs such as `PDD-001`, `E-001`, `F-001`, `S-001`, `T-001` after checking supplied artifacts; these are not published tracker IDs. Each artifact records its revision, evidence/decision sources, owner (confirmed/proposed/Unknown), and unresolved questions. References identify ID plus path or supplied source and revision; never invent a persisted path. New drafts can use `draft:<id>@<revision>`.

| Artifact | Direct parent | Purpose | Template |
| --- | --- | --- | --- |
| PDD | None | Product direction and discovery record | [PDD](templates/pdd.md) |
| Epic | PDD | Coherent initiative toward an outcome | [Epic](templates/epic.md) |
| Feature | Epic | Bounded user-valued capability and its specification | [Feature](templates/feature.md) |
| Story | Feature | Narrow observable end-to-end behavior | [Story](templates/story.md) |
| Implementation Task | Story | Engineering work needed for that behavior | [Task](templates/task.md) |

Read these via `skill://product-planning/templates/<name>.md` or the resolved skill directory; they are templates, not existing product artifacts. Do not materialize all five for an assignment at one level.

Research, Spike and Enabler Tasks may attach to the closest justified PDD/Epic/Feature/Story. Declare `task_type`, why that parent fits, the bounded learning or enabling outcome, and an observable exit condition. Never disguise technical groundwork as user value or invent a Story solely to make the tree regular.

`parent` is containment. `blocked_by` contains only real prerequisites: identify the work/decision/access reference, needed input and condition that unblocks it. Do not infer blockers from ancestry, role order or wishful scheduling. An Epic can be In Progress while its Feature starts. Reject cycles and redundant transitive edges. A missing link can remain Unknown in a draft; downstream commitment must resolve direction/scope traceability, not fabricate approved ancestors. For changed source revisions, identify affected children and recheck their readiness/acceptance; never silently rewrite criteria to make a candidate pass.
An unknown possible dependency belongs in open questions, not `blocked_by`, even when
called conditional. Record a blocking edge only after establishing the needed input
and what work cannot proceed without it. Distinguish blocked implementation or commitment
from still-possible drafting; a request for sequencing advice does not itself block a draft.

## Separate document, evidence, delivery and outcome states

- **PDD `document_status`: Draft | In Discovery | Direction Approved.** Approval needs a decision reference, actual authority and exact approved revision/scope. The document remains living; a material direction change needs renewed approval and must not inherit the old revision's approval. In Discovery is not approval; Direction Approved is not evidence that every hypothesis is true.
- **Claim `evidence_status`: Hypothesis | Supported | Contradicted | Inconclusive | Validated.** Track each claim separately with source/date, method, population/context, findings, counterevidence and limits. Validated is exceptional: a bounded test met an explicit decision criterion, with that scope and evidence recorded. Founder agreement is a decision, not customer validation. New or conflicting evidence can change any claim's assessment; these states are not an irreversible progress ladder.
- **Epic/Feature/Story/Task `delivery_status`: Draft | Refining | Ready | In Progress | Blocked | Done | Stopped.** A proposal starts Draft; refinement supplies its missing contract; Ready satisfies the relevant gate; In Progress requires an actual authorized start; Blocked identifies a real unmet prerequisite; Done requires the exit evidence below; Stopped records the decision/scope. Record transitions from facts, never automatically from generated children or suggested plans. Blocked returns to the state warranted by evidence once resolved. Material scope/criteria changes invalidate prior readiness or completion for the changed revision.
- **PDD/Epic/Feature `outcome_status`: Not measured | Measuring | Supported | Not supported | Inconclusive.** This concerns a defined product outcome with metric, population, baseline availability, target/decision rule, window and data source. A plan to instrument is not measurement. Report uncertainty and counterevidence; do not claim causal impact from delivery or uncontrolled metrics alone.

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

## Readiness: team working agreement, not a universal framework gate

Only assess the requested scope. Drafting is allowed with questions; commitment is not. A missing decision blocks the work that depends on it, not unrelated research or every sibling. Report **met / unmet / not demonstrated** with evidence instead of checking boxes automatically.

Readiness, execution authorization and observed start are separate facts. `Ready` and a
confirmed owner do not grant permission to start. A readiness-only assignment returns a
recommendation to the parent/decision owner; its Next owner action remains conditional
on the applicable start authorization. Record existing authorization when supplied
without asking for duplicate approval. Do not write an execution directive, imply an
assignment was accepted, or mark In Progress without evidence of the authorized start.

- **PDD direction:** actual decision owner approves a specific bounded direction/revision with known uncertainty and constraints. No requirement to prove all hypotheses before selection or experiments.
- **Epic:** chosen outcome and PDD direction traceability, bounded initiative/non-goals, selection authority, coordinating owner, next slice/learning step and relevant risks. It does not require every Feature or Story specified. Ready means ready to pursue that authorized initiative, not all children ready to build.
- **Feature/Story implementation:** accepted current scope and source revision; observable acceptance criteria; necessary UX/technical/security/data decisions or explicitly accepted bounded risks; real prerequisites ready; confirmed ownership; safe verification approach. Use existing team criteria where supplied and identify conflicts rather than inventing all-team sign-off. Story readiness does not require its enclosing Epic to finish.
- **Implementation Task:** current accepted Story/Feature references, clear scope and owner, required contracts/access, independent or coordinated file ownership, safe verification and verifiable exit.
- **Research/Spike/Enabler Task:** authorized bounded question or enabling scope, method/work and safe environment/data access, relevant decision owner, time/cost appetite only if supplied, learning/unblock exit and next decision. No false implementation acceptance requirement before exploration. Enablers do not silently expand product or infrastructure scope.

## Definition of Done and evidence review

Common delivery floor, specialized to the item's accepted scope: current observable acceptance is met; integrated behavior is demonstrated where applicable; required review and risk checks are evidenced; relevant contracts/docs are updated where affected; remaining gaps and residual risk are explicit. Required unmet criteria cannot be waived by labeling them residual risk. An authorized scope change creates a new revision and an explicit decision, not retrospective success on the old criteria.

Tasks additionally meet their specific verifiable exit condition. For research this is actual findings, method/limitations and the resulting recommendation, including inconclusive findings when warranted. Feature/Epic completion requires the accepted aggregate scope demonstrated, not just all Tasks marked Done. Partial release/scope is identified explicitly; it cannot silently stand in for the whole initiative. No requirement to demonstrate hypothetical out-of-scope future work.

QA supplies independent criterion evidence; PO recommends acceptance; authorized decision owners decide acceptance and release under project policy. Engineering does not self-approve independent QA or release. Evidence records the candidate identity, artifact/criteria revision, environment, steps, expected/actual observations and source. Classify each criterion as met, not met or not demonstrated. Absent evidence is not a pass or an observed failure. A proposed check is not an executed result. Keep outcome evaluation separate for PM after delivery.

## Return contract

Return **Outcome**, **Deliverables**, **Evidence**, **Risks and blockers**, and **Next owner**. Include only the assigned artifact(s) or assessment, provisional identity/revision and current state, source traceability, exact missing decisions and next owner. Do not imply persistence, approval, publication, release, interviews or runtime checks occurred unless actually evidenced. For targeted unresolved decisions, use `grilling` when assigned; do not restart discovery just because it is available.
For read-only assessments or smoke assignments, Next owner returns findings for review.
Do not direct the parent to persist or begin execution when those actions are outside
the assignment; make any later recommendation explicitly subject to its authorization.

**Deliverables MUST contain the complete assigned artifact in the final returned
response/yield payload**, not just IDs, section names, a synopsis or a claim that a
draft exists in reasoning/history. For a Feature this includes actual flows, criteria,
open decisions, readiness and handoff; other levels include their relevant template
content. An authorized existing artifact reference is sufficient only when the assignment
requests review rather than drafting. Keep the artifact concise, not omitted.

Before returning, inspect the response that will actually be delivered: each criterion
must name its supplied requirement or accepted contract/invariant. Move unsupported
criteria to open decisions, remove claims that assume unresolved choices, and verify
that no body content was lost when packaging the handoff.
