---
name: worker-handoff
description: Shared-output, handover and takeover rules for the software-engineer and platform-engineer workers. Loaded by those workers when assigned; the main session and the Technical Lead do not use it.
---

# Worker Handoff

## What this is for

Workers write in parallel, so generated files and ownership changes need one owner at a time. These rules keep a lockfile, a formatter run or a half-finished handover from overwriting another worker's changes.

## Rules

- Command-generated changes are your mutations: lockfile updates, formatter or code generation, migration or config generation, workspace rewrites.
- Shared outputs (lockfile, generated files, formatter output, migrations) have one integration owner named by the Technical Lead. Only that owner runs the generating command, after contributing edits settle; other workers return the change they need instead of regenerating.
- An unplanned generated change is reported to the Technical Lead as a dependency, not delivered as a completed edit.
- Handing over: stop edits and mutating commands in that scope, letting in-flight commands finish or interrupting them safely. Send a checkpoint naming changed paths, intent, partial state, outstanding operations and any process that can still write there. Ownership moves only when the Technical Lead acknowledges it and states the new ready condition; afterwards make no edits there and send later needs to the Technical Lead as dependencies.
- Taking over: mutate only after the Technical Lead confirms the previous owner's checkpoint reports no running writer. Differences between that checkpoint and the files are a finding for the Technical Lead, never something to merge or overwrite.
