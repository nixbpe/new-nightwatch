#!/usr/bin/env bash
# Set up a new git worktree for parallel NightWatch development:
# create the worktree (+ branch), install dependencies, set up e2e,
# and print the worktree's isolated dev ports (scripts/ports.mjs).
#
# Usage:
#   scripts/setup-worktree.sh <path> [branch]   new branch (default: basename of path)
#   scripts/setup-worktree.sh --detach <path>   detached HEAD (disposable testing)
#
# Example:
#   scripts/setup-worktree.sh ../nightwatch-feat-auth feat/auth
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

detach=0
if [ "${1:-}" = "--detach" ]; then
  detach=1
  shift
fi

path="${1:-}"
branch="${2:-}"
if [ -z "$path" ]; then
  echo "usage: scripts/setup-worktree.sh [--detach] <path> [branch]" >&2
  exit 2
fi

command -v bun >/dev/null 2>&1 || {
  echo "error: bun is required (see packageManager in package.json)" >&2
  exit 1
}

# Resolve to a single absolute path up front: relative paths follow the
# caller's cwd, and every step below uses the absolute form.
case "$path" in
  /*) wt="$path" ;;
  *) wt="$(pwd)/$path" ;;
esac

if [ "$detach" -eq 1 ]; then
  git -C "$REPO_ROOT" worktree add --detach "$wt" HEAD
elif [ -n "$branch" ]; then
  git -C "$REPO_ROOT" worktree add -b "$branch" "$wt"
else
  # git names the new branch after the path basename.
  git -C "$REPO_ROOT" worktree add "$wt"
fi
wt="$(cd "$wt" && pwd)"

echo "==> Installing workspace dependencies"
(cd "$wt" && bun install --frozen-lockfile)

echo "==> Setting up e2e (deps + Chromium)"
(cd "$wt" && bun run e2e:setup)

echo "==> Worktree ports"
bun "$wt/scripts/ports.mjs"

branch_line=""
if [ "$detach" -eq 0 ]; then
  actual_branch="$(git -C "$wt" symbolic-ref --short HEAD)"
  branch_line="  git branch -d $actual_branch"
fi

cat <<EOF

Ready. Next steps:
  cd $wt
  bun run dev     # API + web on this worktree's ports
  bun run e2e     # starts both dev servers itself, then runs Chromium specs

Cleanup when done (feature worktrees — commit or stash first, remove only when clean):
  cd $REPO_ROOT
  git -C $wt status  # must be clean
  git worktree remove $wt
$branch_line
  (--force is for disposable detached worktrees with no work to keep)
EOF
