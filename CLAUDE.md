@AGENTS.md

## Claude Code

- Orchestrated delivery (`/implement-issue`, `/review-pr`) runs in a main session started with `claude --agent tech-lead`. Subagents cannot dispatch other agents.
- Agents live in `.claude/agents/`, skills and slash commands in `.claude/skills/`, checklists in `.claude/references/`.
- `bun run agent:check` validates agent, skill and reference wiring under `.claude`.
