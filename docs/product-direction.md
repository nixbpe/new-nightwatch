# NightWatch — Product Direction

## 1. Document controls

| Field | Value |
| --- | --- |
| ID / revision | DIR-001 / v2 — retained direction source revision, not a new approval candidate |
| document_status | Direction Approved |
| outcome_status | Not measured |
| Parent | None — root product direction |
| Owner | Product Owner role proposed; accountable person not yet confirmed |
| Direction decisions | User-selected boundaries D1–D9 below; the user authorized incorporating these decisions and the PO recommendations into this revision |
| Approval boundary | Historical provenance: the unchanged direction scope was approved under the former discovery artifact identity PDD-001 v2 on 2026-09-07; that approval remains bounded to the same direction content now identified as DIR-001, not a new Product Design Document. E-001 v0 scope was approved on 2026-09-07; E001-A1 authorized F-001 drafting. F001-A1 approved F-001 v1. Subsequent F001-D2/D3 confirmed C1–C9/G1–G23; working F-001 v3 incorporates these answers and bounded read-only reviews F001-R3. Integrated v3 acceptance, exact proposed contract freeze and readiness evidence remain outstanding. No other planning artifacts, research execution, implementation or release are authorized; research protocols/measurement definitions remain proposals |
| Revision purpose | Focus the new product on explainable technical-risk prioritization for service-provider Platform/SRE teams, across Projects within one customer |

This **Product Direction** document retains the product why, discovery, boundaries and outcomes; it is not a Product Design Document (PDD). The former discovery artifact ID PDD-001 is retired and appears only as historical provenance; it must not be reused for a new design candidate. NightWatch is a **new, multi-tenant, AWS-first cloud security platform**, using **Project** as the operational product term. Platform framing and terminology follow [Repository instructions](../AGENTS.md). This document defines product intent, not implemented capabilities or customer-validated demand.

### Decision record

Source: the user's nine answers to the PO-review grilling rounds in this conversation, followed by the historical request “ดำเนินการปรับ pdd ตามคำแนะนำได้เลย”. These local decision IDs preserve the answer-to-scope mapping; they are not tracker IDs or customer evidence. The precise answer timestamps are not recorded here. In the former discovery artifact's history, the source was v1 and those decisions were incorporated as v2. This rename retains that direction content and source revision; it creates no new approval or Product Design candidate.

| ID / source | User-selected direction | Consequence for the first scope |
| --- | --- | --- |
| D1 / Q1: B | Platform/SRE responsible for security is the primary user | Security specialists, administrators and reviewers are supporting participants rather than equal primary audiences |
| D2 / Q2: A | Help users identify and prioritize risks to address first | Decision support is the main job, not change detection or remediation verification |
| D3 / Q3: A | Prioritize using real-system risk context, not severity alone | Use supported technical context such as exposure and permissions; business importance is explicitly excluded by D8 |
| D4 / Q4: A | Recommend a provisional order when context is incomplete | Explain knowns and unknowns; missing data must not imply low risk |
| D5 / Q5: A | Finish when the user can decide what to do next | Provide reasons, affected resources and remediation or investigation guidance; native assignment and completion tracking are not required |
| D6 / Q6: C | Serve providers managing AWS for multiple customer organizations | Design for provider operators; buyer, access approver and actual pilot participants are still separate unknowns |
| D7 / Q7: B | Compare multiple Projects within one customer | Do not prioritize across customers in the first scope |
| D8 / Q8: C | Do not use business criticality in the first scope | No mandatory business-context entry or confirmation; technical order is not claimed to be the customer's optimal business order |
| D9 / Q9: A | Deliver an explainable priority order with inspectable evidence | Show reasons, evidence, affected resources/Projects, uncertainty and next steps; numeric scores and common-cause grouping are not first-scope requirements |

D8 narrows D3: “real-system risk” means **observed technical risk** in this scope, not customer business importance. None of D1–D9 establishes market demand, correctness of a ranking method or measured benefit.

## 2. Vision, users and problem

### Positioning

**NightWatch helps service-provider Platform/SRE teams responsible for AWS security choose which technical risks to address first across multiple Projects belonging to one customer, with inspectable reasons, evidence, data limitations and practical next steps.**

The selected value proposition is **understand the order → inspect its basis → choose the next action**. Compared with assembling context from separate security outputs, NightWatch proposes a customer-scoped, cross-Project decision view. Whether this produces a meaningful advantage over existing tools remains a hypothesis, not a competitive superiority claim.

### Users and responsibilities

| Relationship to the first scope | User / participant | Job |
| --- | --- | --- |
| Primary — selected in D1/D6 | Platform/SRE at a provider managing AWS for customer organizations | Review one customer's technical risks across Projects and choose a defensible next action |
| Supporting — proposed | Security specialist | Help interpret technical evidence and difficult cases; not assumed to be available for every decision |
| Supporting — proposed | Provider/customer access administrator | Authorize the appropriate cloud and workspace access; not assumed to be the buyer or everyday operator |
| Supporting — proposed | Person carrying out the next action | Receive sufficient context through the team's working process; may be the same operator, without requiring a NightWatch assignment workflow |
| Adjacent — not first-scope drivers | Auditor, compliance reviewer, IAM/GRC operator | Separate evidence-review or access-governance jobs needing their own scope decision |

The first segment is selected: **service providers managing AWS for multiple customers**. Named providers, buyer/budget owner, cloud-access approver, pilot participants, organization size and procurement constraints are not yet known. A provider operator may hold separately authorized memberships in multiple customer Organizations; this does not authorize cross-Organization aggregation or a cross-customer priority order.

### Problem and current-journey hypothesis

Candidate trigger: an operator reviews the next security work for one customer after assessment results become available. A recurring review cadence or a specific external deadline is not established.

**Hypothesized current journey:** choose a customer → gather findings from its Projects/tools → compare severity and technical context manually → investigate gaps → select a remediation or investigation action → continue through the team's existing working process.

Potential friction includes equal-severity findings with different exposure or permissions, repeated context gathering across Projects and uncertainty about what incomplete data means. Which steps actually occur, their frequency, effort and consequences require observation; this is not a customer interview result.

Candidate alternatives include provider-native security tools, specialist scanners, an existing security platform and manual coordination through tickets or spreadsheets. They may already provide adequate context with lower adoption cost. Discovery must examine those strengths and reasons not to switch.

**Why investigate now — hypothesis:** provider operators may benefit from a consistent way to choose technical work within a customer without adding a new work-management system. No market urgency, savings, adoption rate or customer willingness to pay has been established.

## 3. Product model and selected scope

### Organizing concepts

- **Organization / customer organization:** one customer organization corresponds to one NightWatch Organization, the tenant isolation boundary under the repository's architecture rules. “Customer” is business wording for that context, not a separate entity or an additional containment layer in this scope.
- **Project:** the operational unit containing authorized cloud scope and its observations; first-scope comparisons span authorized Projects within the same Organization.
- **Cloud target / resource:** the authorized AWS scope and observed assets, with identities sufficient to preserve customer and Project context.
- **Finding / evidence:** a technical observation and its supporting material, including provenance, scope, freshness and limitations.
- **Priority recommendation:** an explainable relative order based on supported technical context, not a promise of complete detection or optimal business prioritization.

These concepts do not introduce database schemas, screens or a permission hierarchy. Business-criticality labels, service valuation and ownership entry are not prerequisites for first-scope recommendations.

### First-scope value loop

The selected loop combines D1–D9:

1. Establish or access the authorized AWS observations for one customer and its relevant Projects.
2. Review a technical-risk priority order spanning those Projects, rather than separate severity-only lists.
3. Inspect why an item is placed where it is, its supporting evidence, affected resources/Projects and relevant unknowns.
4. Decide on a remediation or further-investigation action using the explanation and practical next-step guidance.

**Endpoint:** the operator can explain the selection and take it into the team's working process. NightWatch need not assign the action, deliver it to another system, track its status or verify remediation to complete this first value loop. Choosing to investigate an important unknown can be a legitimate next action; definitive remediation is not implied when evidence is insufficient.

D3/D8 select technical context, including exposure and permissions where supported, but do not specify a scoring formula, weights, signal precedence or exact AWS check coverage. D4 requires provisional recommendations with visible limitations; how to compare particular incomplete-evidence cases remains a ranking-contract decision, not a license to treat unknowns as safe.

### Capability landscape — not a delivery checklist

| Capability | Relationship to the selected loop | Refinement boundary |
| --- | --- | --- |
| Authorized workspace/cloud onboarding | Enables access to the customer's observations | Account/region/resource coverage, connection responsibilities and usable onboarding path |
| Assessment and evidence collection | Supplies technical observations and their scope/freshness | Checks, cadence, supported technical signals and incomplete-collection behavior |
| Cross-Project prioritization and investigation | Core decision-support value | Evidence-backed ordering, consistent explanations, resource identity and actionable guidance |
| Native assignment, ticket handoff and remediation tracking | Possible later coordination extension; not required by D5 | Separate user need and scope decision before any workflow or integration commitment |
| Reports and notifications | Possible supporting capabilities; not required to finish the selected loop | Audience, content, formats, channels and delivery expectations only if subsequently selected |
| Health, service objectives, access governance and broader compliance | Adjacent product opportunities, not equal-priority core modules | Demonstrated jobs and explicit direction decisions |

### First-scope boundaries

- No cross-customer prioritization; the operator considers one customer's authorized Projects at a time (D7).
- No business-criticality ranking or claim that the technical order is the best business order (D8).
- No required numeric score or common-cause grouping (D9). An explainable order is still required; its calculation contract remains open.
- No required native assignment, external ticket delivery, remediation lifecycle or proof-of-fix workflow (D5).
- No autonomous cloud changes/access revocation, certification guarantee, exhaustive risk-detection claim or provider parity promise.
- No implied reporting suite, notification channels, hosted/self-operated selection, commercial tiers or launch date.

These are boundaries of the selected first scope, not permanent bans on later capabilities. Additional providers, including GCP, require a separate scope decision; AWS-first does not imply complete AWS coverage.

## 4. Desired journey and observable value

The journey below expresses the selected product direction. Exact interaction design and technical contracts remain to be refined.

| Stage | Actor, input and intended experience | Observable user result / decision basis |
| --- | --- | --- |
| Establish context | Provider operator selects a customer and accesses its authorized Projects and AWS observations | Knows which customer, Projects and observed scope are included; cannot mistake unavailable data for a completed healthy assessment |
| Review priorities | Operator reviews the customer-scoped technical order across Projects | Can identify a candidate next item without assuming severity alone or business criticality determines its position |
| Inspect the recommendation | Operator examines reasons, supporting evidence, affected resources/Projects and known data gaps | Can distinguish observed technical context from uncertainty and understand the basis for the recommendation |
| Choose the next action | Operator uses remediation or investigation guidance to decide what to do outside or after this decision-support step | Can explain the selected action, scope, rationale and unresolved questions without needing a NightWatch assignment or completion state |

Partial collection, stale observations, unequal Project coverage and insufficient permission must remain understandable within the loop. D4 permits a provisional recommendation; it does not permit concealing uncertainty. Unsupported inferences about exposure, customer impact or successful remediation must not appear as facts.

This journey is a design to evaluate, not observed usage. The initial learning comparison is against the participant's actual decision process, not a fabricated “before” workflow.

## 5. Trust, constraints and risks

- **Isolation:** multi-customer service work must preserve Organization isolation and authorized Project visibility. Each comparison stays within one customer Organization; membership in another Organization does not extend the current comparison's scope. Verify membership and operation permissions under the established architecture contracts, without adding a customer-to-tenant mapping layer.
- **Evidence integrity:** retain understandable provenance, scope and freshness. Missing context is not low risk; no findings is not proof of successful collection, completeness or safety (D4).
- **Explanation integrity:** distinguish technical risk from business priority (D3/D8). Explain the basis and limitations of provisional recommendations rather than implying numerical precision or complete knowledge (D9).
- **Action boundary:** advice is not execution, assignment, acknowledgement or proof of remediation (D5). A finding's disappearance alone does not prove a fix.
- **Accessibility:** follow [Design rules](design-system.md), including understandable states, legible content, keyboard/focus behavior and non-color-only meaning.
- **Operational feasibility:** assess required observation privileges, collection cost, evidence retention and data-control constraints for the selected customer scope. No availability, latency or operating-cost target is established here.

| Risk | Consequence | Proposed response / owner |
| --- | --- | --- |
| Existing tools already solve prioritization adequately | Adoption adds cost without useful decision improvement | PO/UX: observe real decisions and alternative-tool strengths |
| Technical ordering is mistaken for business importance | Operator makes an inappropriate customer-level decision | PO/UX with security input: test whether users understand the D8 boundary |
| Projects with fewer observations appear less risky | Incomplete coverage creates false reassurance | Technical/security and UX input: define and test incomplete-evidence comparisons under D4 |
| Explanations sound convincing without sufficient evidence | Faster but less defensible decisions | Security/QA with UX input: evaluate rationale and action correctness, not speed alone |
| Organization membership or scope is enforced incorrectly | Cross-customer disclosure or incorrect aggregation | Technical/security input: verify the established membership, permission and single-Organization boundaries in the affected implementation |
| Onboarding effort, privileges or data constraints outweigh value | Provider cannot adopt the product safely or economically | PO with technical input: study actual buyer, approver and operator constraints |

Response roles are proposed; named owners and accepted risk decisions are not recorded. This document does not authorize collection of customer credentials or sensitive evidence.

## 6. Evidence and discovery plan

### Evidence state

D1–D9 record user direction, not validation. No customer observations, empirical ranking evaluation or measured outcomes are recorded. For the active claims below, `evidence_status` is **Hypothesis**; empirical source/date, observed population and actual results are **Unknown / not collected**. PO review is document analysis, not market evidence.

H1, H2, H4, H5 and H6 retain their v1 identities with the selected audience and scope made explicit. H3 concerned native action coordination; D5 defers that investment, so H3 is **not part of the initial study** and is neither validated nor rejected by this decision.

### Proposed investigations — all Not run

| Claim | Bounded method and population | Support / reject / inconclusive signals |
| --- | --- | --- |
| H1 — Provider operators have a recurring within-customer prioritization problem | Walk through recent decisions and sanitized artifacts with Platform/SRE staff managing AWS for customers; examine several Projects within each chosen customer | Support: traceable repeated context-gathering or comparison problems affect decisions. Reject: their current approach adequately solves the job. Inconclusive: only opinions or insufficient concrete examples |
| H2 — Explainable cross-Project technical ordering improves next-action decisions | Compare the participant's approach with a proposed NightWatch journey on comparable, sanitized customer scenarios; inspect reasons and guidance, not just the final order | Support: defensible decisions improve or require less effort without a quality loss. Reject: material misleading recommendations or no useful benefit. Inconclusive: tasks are not comparable, the reference rubric is disputed or evidence is insufficient |
| H4 — Operators interpret provisional technical recommendations safely | Include incomplete, stale and uneven-coverage scenarios across Projects; ask participants to explain what the order does and does not establish | Support: operators distinguish knowns, unknowns and technical versus business priority. Reject: explanations lead to false safety, unsupported exposure or business-importance assumptions. Inconclusive: scenarios do not exercise these distinctions or results are mixed beyond agreed criteria |
| H5 — A feasible initial AWS scope supplies enough context for the chosen job | Review representative inventories, observation privileges and prioritization examples with provider operators and relevant access approvers | Support: a bounded accessible scope supports useful comparisons and practical next steps. Reject: missing essential signals or access constraints prevent the selected job. Inconclusive: inventories/access requirements are not representative or cannot be inspected safely |
| H6 — Decision-support value justifies adoption and operating cost | Examine actual procurement, data-control, onboarding and operating responsibilities with prospective provider buyers/operators | Support: concrete value/cost trade-offs and a plausible adoption path exist. Reject: existing tools or operating constraints negate the value. Inconclusive: only stated interest, no buyer context or no realistic cost information |

These are proposed qualitative decision rules, not completed protocols or numerical thresholds. Agree task selection, cohort, reference rubric and aggregate support/reject/inconclusive criteria before running a study. Do not retrofit criteria to favorable answers.

**First proposed learning step:** H1, followed by H2/H4 on relevant scenarios if separately authorized. The H1 exit is a documented decision to retain, revise or reject the problem hypothesis for the observed cohort, including contrary examples. It need not reopen the selected direction without new evidence. Named participants, consent, safe materials, study owner and execution authorization are prerequisites for participant research, not for this Product Direction update or desk research.

## 7. Outcomes and measurement

**Primary desired outcome:** provider Platform/SRE operators can choose a defensible next technical action across one customer's Projects with less decision effort, without being misled by incomplete data or treating technical order as business priority (D1–D9).

Measurement definitions below are **proposals**, not approved targets or existing telemetry. Baselines, target values, cohort size and aggregate evaluation window are unknown. Proposed owner: Product Owner with UX/security input; the named owner is not confirmed.

| Measure | Proposed definition and unit | Baseline / collection plan | Interpretation and guardrail |
| --- | --- | --- | --- |
| Defensible next-action task success — primary | Tasks meeting the agreed rubric divided by all attempted tasks; report counts and percentage per study cohort. Proposed rubric covers selected action, affected scope, supporting rationale and acknowledged uncertainty | Observe comparable current-method and proposed-journey tasks. Agree the rubric with domain input before execution; allow multiple defensible answers rather than enforcing one invented perfect order | Include failed/abandoned attempts in the denominator and report reasons separately. Do not count task speed or mere agreement with the displayed order as correctness |
| Decision effort — paired with success | Elapsed minutes from starting the customer-scoped review to the next-action decision, plus observed context-gathering steps, per task | Record consented task observations and timestamps. Choose the cohort observation window and aggregation method before the study; retain task-level results | Report completion/failure/abandonment separately; do not interpret fast abandonment or faster incorrect decisions as improvement |
| Safe interpretation — guardrail | Attempted adverse-data scenarios in which the operator correctly explains scope, unknowns and the technical/business distinction, divided by all attempted adverse-data scenarios; counts and percentage | Use H4 scenarios and record errors with reasons; establish interpretation criteria and thresholds before testing | A favorable average must not hide material false-safety or cross-customer-scope mistakes |
| Time to a usable comparison — adoption diagnostic | Minutes from starting authorized customer setup to correctly reviewing a comparison across its relevant Projects, per onboarding attempt | Observe onboarding with a representative authorized scope; record incomplete/failed/abandoned attempts alongside completed ones | Do not improve the result by hiding access requirements, shrinking agreed coverage or requiring business-criticality entry contrary to D8 |

H6 supplies adoption/cost evidence separately; faster prototype tasks do not demonstrate willingness to pay, production risk reduction or ROI. All outcomes remain **Not measured**. Collection methods require appropriate consent and data handling; this plan is not permission to instrument customer activity.

## 8. Remaining decisions and handoff

The primary audience, provider context, main job, within-customer comparison scope, technical-only ranking basis, incomplete-data approach and first-loop endpoint are **settled by D1–D9**. Do not ask the user to choose them again during routine refinement.

| Open decision | Affected work and next input | Proposed owner |
| --- | --- | --- |
| Named pilot providers, buyer and access approver | Recruitment and adoption assumptions need real participants and responsibilities; the service-provider segment itself is already selected | User with PO |
| Supported AWS scope and technical signals | Agree account/region/resource/check coverage and available evidence for the selected loop; do not promise complete AWS coverage | Product and technical/security input |
| Ranking and explanation contract | Define evidence sources, comparison rules, signal precedence and behavior under unequal/incomplete coverage within D3/D4/D8/D9; no invented score formula | Product with technical/security and UX input |
| Deployment, data control and operating boundaries | Resolve hosted/self-operated trade-offs, retention and cost expectations using buyer/operator constraints; not inferred from multi-tenancy | Product with technical/platform/security input |
| Research protocol and outcome thresholds | Confirm safe scenarios, rubric, cohort, window, consent, named owner and authorization before studies | PO/UX with security input |

Reporting, notifications, native lifecycle and adjacent modules require later selection, not resolution as prerequisites for this first loop. Unknown details block only the work that depends on them: participant studies need authorized access; affected implementation needs its agreed product/technical contracts. No blanket product blocker is declared.

**Handoff:** DIR-001 retains Direction Approved for the unchanged direction scope identified in the historical approval provenance in §1, outcomes Not measured. E-001 v0 scope approval (E001-A1) and F-001 v1 document approval (F001-A1) remain revision-bound. Current [F-001 v3](planning/F-001-workspace-onboarding.md) integrates user answers C1–C9/G1–G23 (F001-D2/D3) and bounded data/security/UX/QA reviews (F001-R3), not blanket v3 approval. QA confirmed the historical Ready/Done documentary correction in the reviewed v2 candidate; runtime acceptance remains unexercised. Exact T1/U2 contract freeze, integrated acceptance and ownership/environment evidence remain outstanding. No implementation, customer validation or release is claimed or authorized.
