---
name: candidate-validation
description: How a change goes from review-ready to technically verified - independent review, locking the exact code under test, running the release gates, batching repairs and capping repair rounds. Used by the Technical Lead and by workers producing validation evidence.
---

# Candidate Validation

## What this is for

Full technical sign-off needs proof that every check ran against the same code. So the change is first reviewed, then locked as a "candidate" with a fingerprint, and only then tested with the full gates. If any file changes after that, the lock breaks and the affected checks run again. Repairs are batched and capped, so the loop cannot run forever and hard problems come back to a person with evidence.

This skill starts where step 3 of skill:`delivery-orchestration` ends, and is used only when `STOP_AT` is `verified` or the intent is `validate`.

## 1. Candidate binding

- States run `mutating → source-complete → reviewed → bound → validating → verified`; report only the current one. Any source edit returns to `mutating` and focused review.
- Bind a snapshot taken after all writers stopped: a clean commit SHA, or `bun run candidate:manifest` output. Name it `<Feature-id>-C<n>` with its `acceptanceVersion` and manifest digest; every review and gate cites that triple.
- A bound (frozen) candidate is immutable. Any changed file, including formatter or generated output, invalidates it: report `<id> → invalidated`, repair, and bind the next id naming the superseded candidate and the addressed finding IDs.

## 2. Validation loop

1. Send the source-complete snapshot to agent:`code-reviewer`. Repair Blocker/Major findings as one batch (step 4), then repeat affected housekeeping and review. Bind only after a `ready for validation` verdict; record non-blocking findings without forcing repair.
2. Bind the reviewed candidate. In parallel, dispatch agent:`software-engineer` for assigned no-edit application gates and agent:`platform-engineer` for permitted scanner/platform evidence, both tied to that binding. Collect all gate results before repair.
3. Send all producer evidence to agent:`code-reviewer` for its bound-evidence review: per-criterion observed pass/fail/not-verified findings, manifest-to-scanner coverage and a recommended disposition. The Technical Lead alone accepts the candidate, and only when, on the same binding:
   - every required criterion is observed pass;
   - every manifest file, including deleted paths, is scanned or scanner-skipped with reason; `nonCandidateExclusions` are reconciled separately as outside the candidate.

   An observed fail returns for repair; missing, mismatched or not-verified evidence blocks acceptance. Implementation-owner results are author-produced, not independent evidence; manual workarounds are diagnostic only.
4. Triage findings from review, triage or a failed gate into one repair ledger:
   - Classify each as defect, evidence gap, proposal or unsupported; deduplicate, cut anything outside the frozen acceptance scope, and settle conflicts yourself, citing the deciding evidence.
   - Track accepted findings `accepted` → `in_progress` → `fixed` → `verified`, or `rejected`/`deferred`.
   - Repair in-scope defects that violate a criterion or contract; record non-blocking findings and proposals unless assigned. Never weaken a meaningful expectation.
   - Name the regression proof each accepted finding needs, then open one repair cycle for the batch, one dispatch per owner. Once opened, the ledger is closed: later findings wait for the next round.
   - Order the release gate only when the ledger has no open items.

## 3. Focused repair and release gate

Focused repair runs only:
- the formatter on touched files
- lint/typecheck for the affected package(s)
- the regression test targeting the finding
- a DB/E2E scenario only when the finding itself requires that runtime
- a targeted security check scoped to the finding (e.g. one semgrep rule or file), never the full `security`/`security:image` battery

Release gate, ordered by the Technical Lead once the ledger is closed:
```text
bun run validate
bun run test:integration
COVERAGE_GATE=1 bun run test:coverage
bun run e2e
bun run security
bun run security:image
```
PR CI never runs `e2e`; only the human-dispatched `full` job does, so run it locally or report it not verified.

Release-gate failures go to focused repair as one batch and supersede the binding; they do not reopen review by themselves. Fix the cause, reproduce it with a focused check, then rerun only the failed gates. Never send the candidate to final review while any gate is red. A production-code edit after full verification passed retires that evidence; rerun the gates it affects.

## 4. Repair-round cap

Allow one implementation review, at most one repair cycle per integrated review, and one final delta review. If the final delta review still finds something:
- A reproducible Blocker or Major: invalidate the candidate and open a second, final repair cycle, never a third.
- Minor or Nit: file it as a follow-up backlog item by default; do not reopen repair.
- A genuinely new requirement: use the scope change in skill:`acceptance-freeze`, not a repair.

When the cap is used up, including for a gate that stays red, stop and hand the evidence and the decision needed to the user.

## 5. Done

`verified` is done only when all of these hold: acceptance is frozen, every accepted finding is verified, the release gate is fully green, the candidate is frozen, and the final delta review is approved, with no production file changed since full verification passed.
