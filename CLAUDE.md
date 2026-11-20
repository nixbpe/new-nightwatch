@AGENTS.md

## Claude Code

- Use the direct workflow in `AGENTS.md` for routine work. Start `claude --agent tech-lead` for orchestrated delivery (`/implement-issue`, `/review-pr`); role permissions still apply.
- Agents, skills and checklists live in `.claude/agents/`, `.claude/skills/` and `.claude/references/`. Commands and the Technical Lead wire them together; workers do not dispatch.
- Documentation-only rule changes need formatting and reference checks, not application tests or an agent review.
