# Working with Worktrees

Referenced by `git-workflow/SKILL.md`. For parallel AI agent work, use git worktrees to run multiple branches simultaneously instead of switching branches in one directory.

```bash
# Create a worktree for a feature branch
git worktree add ../project-feature-a feature/task-creation
git worktree add ../project-feature-b feature/user-settings

# Each worktree is a separate directory with its own branch —
# agents can work in parallel without interfering.

# When done, merge and clean up
git worktree remove ../project-feature-a
```

Benefits:

- Multiple agents can work on different features simultaneously
- No branch switching needed (each directory has its own branch)
- If one experiment fails, delete the worktree — nothing is lost
- Changes are isolated until explicitly merged
