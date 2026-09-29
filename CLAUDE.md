@AGENTS.md

## Claude Code

- Orchestrated delivery (`/implement-issue`, `/review-pr`) runs in a main session started with `claude --agent tech-lead`. Workers have no `Agent` tool in `tools`, so only that session dispatches.
- Agents live in `.claude/agents/`, skills and slash commands in `.claude/skills/`, checklists in `.claude/references/`.
- Worker agents and leaf skills name neither skills nor agents. Commands (skills with `argument-hint`) and the Technical Lead playbook `task-delegation` wire them together, and `agent:check` enforces this.
- `bun run agent:check` validates agent, skill and reference wiring under `.claude`.
