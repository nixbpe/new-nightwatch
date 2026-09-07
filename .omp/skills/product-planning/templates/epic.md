Template, not an approved product artifact

## Consumption contract — instructions, not artifact content

Apply the Entry protocol and Return contract in `skill://product-planning`; its authority, identity, states, readiness and DoD remain canonical. This template combines outcome/hypothesis framing with bounded delivery scope, not automatic adoption of SAFe or another framework.

- For a complete new Epic, cover every Required section below. For a targeted refinement, review or editorial rewrite, change only the assigned scope; the template does not authorize backfilling the whole artifact or starting discovery.
- Required means the concern must be addressed, not that facts may be invented. Draft with `Unknown — reason; needed evidence/decision; owner or Unknown`. Missing commitment inputs prevent an unsupported Ready claim, not a useful draft or separately authorized research.
- Use stable semantic IDs for hypotheses, metrics, capabilities, constraints and exit criteria. Reference canonical content instead of repeating it; preserve existing IDs and inspect inbound impact when renaming. Keep Accepted/Proposed/Unknown decisions separate from claim `evidence_status`.
- Do not invent numeric targets, baselines, estimates, scores, dates, PI cadence, participants or owners. A measurement method can be Proposed while its target remains Unknown. Proposed work and expected results are not observed evidence.
- Remove these instructions and bracket prompts from the delivered artifact. Retain Required sections with honest gaps; omit optional sections that do not apply. An applicability exclusion needs a reason, not a silently empty field. Honor a supplied output schema; Markdown is sufficient when no machine-readable envelope is requested.

# Epic: [Short customer or business outcome, not a feature list]

## Identity, context and ownership — Required

- `id`: [existing ID, otherwise unique provisional E-001; not a filed tracker item]
- `candidate_ref`: [actual source/snapshot or unpersisted draft reference; revision only when needed to bind decisions/evidence]
- `parent_direction`: [DIR ID / actual path or supplied source and applicable direction candidate/scope; missing link explicit]
- `epic_type`:
  - `value`: [Business / Enabler / Unknown]
  - `decision_state`: [Accepted / Proposed / Unknown]
  - `basis`: [classification source for Accepted; inference/proposal rationale and any supplied source for Proposed; reason no classification is available for Unknown]
- `delivery_status`: [Draft / Refining / Ready / In Progress / Blocked / Done / Stopped]
- `outcome_status`: [Not measured / Measuring / Supported / Not supported / Inconclusive]
- `problem_context`: [specific pain and intended change in one or two sentences; population/context and current evidence refs]
- `current_alternatives`: [what users do now, including doing nothing; evidenced strengths/gaps or hypotheses]
- `strategic_outcome_ref`: [Direction outcome this Epic contributes to; an Enabler identifies the capability/risk reduction and downstream beneficiary it enables]
- `scope_decision_ref`: [actual authority, exact candidate/scope and decision; otherwise pending, not inferred from the parent's approval]
- `source_refs`: [current supporting/contrary evidence, decisions and existing design/architecture/contract links; no fabricated paths or revision/Q&A timeline]

Use one canonical `epic_type` record, not separate confirmed and proposed values elsewhere. Accepted requires an explicitly supplied settled classification and its source; preserve a supplied Proposed state without promoting it. An AI-inferred Business/Enabler value is Proposed with rationale, never Accepted merely because the Epic appears customer-facing or technical. With no supported classification or proposal, both value and decision_state are Unknown with a reason. Accepted/Proposed require a Business/Enabler value. Classification is descriptive, not portfolio adoption or scope approval; preserve settled inputs without duplicate confirmation, and do not make missing classification alone an approval or execution gate.

| Role / stakeholder | Person or supplied role reference | Responsibility / bounded decision authority | Confirmed / Proposed / Unknown and source |
| --- | --- | --- | --- |
| Epic owner | [named owner or Unknown] | [accountability for this Epic's outcome, refinement and evidence handoff] | [assignment source; role label alone is not authority] |
| Sponsor, if applicable | [name/ref or applicability reason] | [actual investment/scope authority, if any] | [source or Unknown] |
| Affected stakeholders | [users/teams/decision owners actually known; otherwise Unknown] | [input needed, affected boundary or decision right] | [source; do not invent people or universal sign-offs] |

## Value hypothesis and evidence — Required

- `hypothesis_id`: [stable semantic reference]
- `value_hypothesis`: For [customer/beneficiary] who [need], [bounded candidate approach] is expected to [measurable benefit]. Unlike [current alternative], it may [meaningful differentiator], because [causal mechanism and evidence or explicit hypothesis].
- `hypothesis_evidence`: [claim evidence_status and sources/counterevidence/limits under the canonical contract; approval is not validation]
- `outcome_metric_refs`: [business-outcome metric IDs below]
- `leading_indicator_refs`: [early-signal metric IDs below and why they should predict the outcome]

Keep one coherent primary value hypothesis. An unselected approach or differentiator stays Proposed/Unknown, not an accepted solution requirement. Unrelated outcomes suggest separate candidate Epics; do not create them without assignment. An Epic must explain value, not merely contain tickets.

## Success metrics and leading indicators — Required

Cover at least one business-outcome metric and one leading indicator. Define numeric measures or an explicitly observable binary result; vague goals such as “improve efficiency” are not measurement definitions. Missing values stay Unknown with a collection/decision plan.

| Metric ID / kind | Definition, unit, population and observation window | Baseline / source / date, or collection gap | Target or decision rule / Accepted, Proposed or Unknown / source | Collection method / data source / owner | Signal timing and relationship to hypothesis | Actual result / evidence / limits |
| --- | --- | --- | --- | --- | --- | --- |
| [semantic ID] / Outcome | [observable business result; calculation and boundaries only when supplied] | [sourced baseline or Unknown + plan] | [sourced target/rule or Unknown + decision needed] | [available source or proposed instrumentation; owner] | [when this result can be evaluated] | [Not measured or actual result with candidate/context] |
| [semantic ID] / Leading | [early observable signal, not the same lagging outcome relabeled] | [sourced baseline or Unknown + plan] | [sourced threshold/rule or Unknown + decision needed] | [safe method/source; owner] | [why this should precede/predict the outcome; testable within the selected learning window] | [Not measured or actual early signal with limits] |

Add guardrail metrics only where relevant to harm, quality or constraints. A completed-ticket count is not a leading indicator without a defensible connection to the value hypothesis. An early signal supports a hypothesis; it does not by itself prove the business outcome or causal impact. Instrumentation planned is not measurement performed.

## Scope, journeys and minimum learning slice — Required

- `in_scope`: [bounded users, capabilities and problem boundaries; trace to the hypothesis]
- `out_of_scope`: [explicit exclusions and rationale; not a requirement to disable those capabilities elsewhere]
- `journey_slice`: [relevant persona/actor and ordered trigger → steps → result; coarse mapping is enough, detailed personas/story maps only if assigned]
- `mvp_hypothesis_refs`: [hypothesis and outcome/leading metric refs this minimum viable product increment will test]
- `mvp_scope`: [smallest end-to-end increment sufficient for the learning decision; capability refs below, included boundary and deliberate exclusions]
- `learning_design`: [proposed method, safe population/exposure and data access, measurement refs, owner or Unknown; not a claim of execution]
- `learning_window`: [sourced observation period/appetite and rationale, or Unknown; do not assume sprints or PIs]
- `decision_rules`: [continue / pivot / stop / inconclusive conditions linked to metric refs, evidence limits, Accepted/Proposed/Unknown status and actual decision owner]
- `mvp_exit_evidence`: [observations needed to make that bounded decision; actual evidence refs only when exercised]

The MVP is a hypothesis-testing increment, not a smaller copy of the entire solution. It retains applicable security, privacy, accessibility and error/permission boundaries. MVP learning completion, Epic delivery completion and outcome success are distinct; neither an inconclusive result nor a positive early signal silently marks the Epic Done.

## Coarse child capabilities and selection — Required

Use the delivery hierarchy **Direction → Epic → Feature → Story → Implementation Task**. Features are the direct delivery children; existing Stories may be referenced through their Features, not reparented directly under the Epic. PDD is a selected Feature's design companion, not a delivery parent; link applicable design candidates through that Feature. Research/Spike/Enabler Tasks retain the canonical parent exception. Do not create child documents or expand the whole backlog automatically.

| Capability ID / actual or provisional Feature reference | Persona / journey step and observable capability | Hypothesis / metric contribution | MVP inclusion / later boundary | Selected / deferred / rejected / undecided and decision source | Known prerequisite / uncertainty |
| --- | --- | --- | --- | --- | --- |
| [semantic candidate/ref, not a fake tracker claim] | [user-valued or explicitly enabling capability, not a mandatory technical layer] | [hypothesis and metric refs] | [included slice or excluded/future scope] | [proposal versus accepted selection; rationale] | [real input dependency ref or open question] |

Keep future candidates rough. If no capability is justified yet, record that gap instead of inventing a catalog. Detail only selected near-term Features when assigned; their specs remain their requirements sources. Sequencing follows actual inputs and learning priorities, not department order or a requirement that the Epic first be Done.

## Dependencies, assumptions, risks and constraints — Required

### Dependencies

| Dependency reference, or None established | Needed input / affected work | Observable unblock condition | Input owner / evidence / next action within assignment |
| --- | --- | --- | --- |
| [actual input, decision, access or item] | [why this particular work cannot proceed] | [what must become available] | [source; confirmed owner or Unknown] |

Only established prerequisites enter `blocked_by`. Parentage is containment, not a blocker; no cycles or automatic role-order edges. A possible dependency without an established needed input stays an assumption/question. Separate blocked execution or commitment from still-possible drafting.

### Assumptions and risks

| Semantic ID / Assumption or Risk | Claim/uncertainty or potential harm | Affected hypothesis, capability or criterion | Test/response and actual evidence, if any | Owner / resolution or explicit bounded risk acceptance |
| --- | --- | --- | --- | --- |
| [stable reference and kind] | [unproven belief versus possible adverse effect] | [refs and impact] | [proposed method/response versus observed result] | [Unknown allowed; acceptance requires authority and scope] |

### Constraints and NFR applicability

Assess every category below. Mandatory assessment does not make every possible regulation or standard applicable. Use **Applicable / Not applicable with reason and source / Unknown with resolution needed**. Do not assume compliance or invent legal obligations, uptime targets, accessibility levels or approved exceptions.

| Category / semantic constraint ref | Applicability and scope | Required boundary or measurable NFR / verification approach | Authority/source and decision state | Owner / unresolved input |
| --- | --- | --- | --- | --- |
| Security | [assessment] | [applicable access/protection boundary] | [current source; Accepted/Proposed/Unknown] | [owner/gap] |
| Privacy / regulatory | [assessment of data, population and jurisdiction] | [sourced obligation; PDPA only where established as applicable] | [source and applicability decision, not inferred certification] | [owner/gap] |
| Accessibility | [assessment] | [sourced interaction requirement/standard, or Unknown] | [source; no default compliance claim] | [owner/gap] |
| Performance / reliability | [assessment] | [sourced metric, unit/window and safe verification, or Unknown] | [source; no invented target] | [owner/gap] |
| Technical / data / operational / business | [assessment] | [actual architecture, interoperability, budget or operational boundary] | [source and accepted scope] | [owner/gap] |

These boundaries apply to the MVP too. Carry applicable constraints into selected Feature contracts; report unresolved applicability instead of treating it as satisfied or waiving it to fit a forecast.

## Sizing, priority and lifecycle — Required

- `rough_size`: [range or relative size, unit/method, scope assumptions, confidence and estimating engineer/team/source; Unknown if not estimated]
- `priority`: [relative ordering/business value and rationale against known alternatives; decision owner, Accepted/Proposed/Unknown and source; no invented score]
- `forecast_or_appetite`: [supplied duration/window/cost bounds and uncertainty, or Unknown; forecast is not a deadline or funding commitment]
- `next_step`: [assigned selection, learning or delivery scope and actual prerequisites; no inferred execution authorization]
- `reassessment_trigger`: [source-backed learning/scope/feasibility condition and decision owner, or proposed condition; prevents indefinite expansion without inventing dates]

Keep current lifecycle state in Identity; do not maintain a second competing delivery status here. A scope or criteria change binds a new candidate and rechecks affected readiness/acceptance; it does not inherit prior Done evidence. Rough sizing belongs to engineering input, priority to the actual scope/ordering authority; neither is fabricated by the template.

## Readiness, aggregate acceptance and exit — Required

- `readiness_assessment`: [met / unmet / not demonstrated, with evidence per relevant gate: current direction/scope; measurable value hypothesis; at least one defined outcome metric and one early leading indicator with accepted targets/decision rules, collection plan and owner; bounded MVP/learning exit; ownership, applicable constraints, relevant risks and actual prerequisites]
- `missing_commitment_inputs`: [exact gap, affected gate and resolution condition; unknown baseline may have a defined collection plan, unknown decision thresholds cannot be treated as accepted]

A draft may expose missing gates. Do not recommend Ready for commitment on a feature list, unmeasurable outcome, lagging-only metric set or full-solution MVP. This does not prohibit separately authorized bounded research. Readiness needs a safe approach, not completed implementation, executed MVP results or passing future runtime tests.

| Epic exit ID / accepted scope refs | Aggregate observable completion criterion | Safe evidence method / candidate and verification owner | Actual result: met / not met / not demonstrated | Evidence source / gaps |
| --- | --- | --- | --- | --- |
| [semantic exit ref] | [accepted whole-scope behavior or enabling result and relevant integration/constraint boundary; not ticket counts] | [how current-candidate completion will be observed; proposed until run] | [actual assessment only] | [result ref or missing evidence] |

Only supplied accepted requirements enter committed exit criteria; proposed criteria stay explicitly separate pending a decision. Keep criteria bounded and sufficient, not an arbitrary number. Reference child acceptance rather than duplicating competing Feature specs.

- `delivery_completion`: [accepted aggregate scope and applicable integration/risk checks evidenced; known gaps and affected contracts/docs accounted for]
- `learning_decision`: [MVP rule refs, actual observations and authorized continue/pivot/stop/inconclusive decision, or not yet evaluated]
- `outcome_result`: [metric refs and actual results/limits; delivery is not outcome validation]
- `release_authorization`: [separate actual decision/evidence if applicable; otherwise not granted]

Closing all children is not sufficient for Epic Done. Conversely, unselected future ideas do not prevent closing a clearly accepted bounded scope. Required unmet criteria are not waived as residual risk. Stopping, splitting or changing scope requires an explicit decision; an MVP exit does not silently replace the accepted Epic exit.

## Portfolio and framing extensions — Optional, context-dependent

Include only when explicitly relevant to the assigned context; link existing artifacts rather than creating additional planning layers.

- **Working Backwards / PR/FAQ:** customer-perceived improvement over current alternatives, hard questions and current source reference. Use for framing when assigned, not as a mandatory new document.
- **Lean Business Case / funding:** for an adopted portfolio investment process, record alternatives, estimated investment/ongoing cost, forecast, risk and actual funding/go-no-go authority/source. Missing estimates remain Unknown; do not invent LPM or sponsor approval.
- **Portfolio Kanban:** if adopted, record the sourced `portfolio_status` (for example Funnel, Reviewing, Analyzing, Portfolio Backlog, Implementing, Done) and the explicit local mapping, if one exists. Keep it distinct from canonical `delivery_status`; same-name states do not imply equal criteria, approval or execution authority.
- **WSJF:** use only for explicitly comparable Epics competing for shared capacity and an adopted scoring method. Record comparison set, shared scale/calibration facilitator, source/date, User-Business Value, Time Criticality, Risk Reduction/Opportunity Enablement and relative Job Duration. `WSJF = (User-Business Value + Time Criticality + Risk Reduction/Opportunity Enablement) / Job Duration`. Compute only with complete comparable inputs and a positive denominator; otherwise report not computable, never fabricate inputs or ranking. Preserve exact ratios when no rounding rule is supplied. A score informs priority; it does not approve scope or funding.
- **PI and size heuristics:** only if the team adopts the supplied guide's PI-based policy, seek an early signal within the first PI and an MVP learning slice within at most two PIs. A longer forecast calls for a scope/learning review, not hidden work deletion. More than two–three PIs without closed Stories, or more than three–five Story criteria, are review signals rather than universal size definitions or automatic split commands. Use supplied cadence; do not infer PI length. Never omit essential security/error/permission criteria to meet a count. Without a PI process, use the sourced learning window instead.

## Handoff — response metadata, not a required persisted section

Apply the canonical Return contract. Before returning, check that outcome and early signal are distinct; the MVP can answer its hypothesis; child capabilities trace to value; constraints were assessed; estimates and approvals have sources; and delivery, learning and outcome exits are not conflated. Report gaps rather than inventing values or expanding the assignment.

- **Outcome:** [current delivery/outcome states, bounded conclusion and unapproved decisions]
- **Deliverables:** [complete assigned Epic for `full_artifact`; actual changed paths for `file_summary`; bounded findings with source locations for `assessment`]
- **Evidence:** [current sources, counterevidence and observed checks/results versus proposed work; candidate and coverage limits]
- **Risks and blockers:** [exact missing inputs, affected work and resolution conditions; outside-scope reference impact]
- **Next owner:** [actual recipient and action within this assignment, or None; later research, implementation, review or funding action only if separately authorized]
