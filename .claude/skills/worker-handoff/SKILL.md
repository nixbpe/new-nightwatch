---
name: worker-handoff
description: Transfer owned work and shared outputs without overlapping writers or overwriting another contributor's changes.
---

# Worker Handoff

## What this is for

Keep one writer per shared output and transfer ownership only through the authorized coordinator.

## Rules

- Treat command-generated changes as your mutations, including lockfiles, formatting, code generation, migrations, configuration, and workspace rewrites.
- Give shared outputs one integration owner. Only that owner runs their generating commands after contributing edits settle. Other workers return the required change.
- Report unplanned generated changes as dependencies, not completed edits.
- Before handover, stop edits and mutating commands. Let in-flight work finish or interrupt it safely. Report changed paths, intent, partial state, outstanding operations, and processes that can still write.
- Transfer ownership only after the coordinator acknowledges that checkpoint and states the new ready condition. Make no later edits in that scope; report further needs as dependencies.
- Before takeover, require confirmation that the previous owner has no running writer. Report discrepancies between the checkpoint and files. Never merge or overwrite them without a decision.
