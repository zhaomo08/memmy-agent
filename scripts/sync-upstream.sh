#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/sync-upstream.sh [--prepare-develop]

Safely fast-forwards the fork's main branch from MemTensor/memmy-agent.

Options:
  --prepare-develop  Also create a sync/upstream-<sha> branch from develop and
                     merge the synchronized main branch into it for testing.
  -h, --help         Show this help.
EOF
}

prepare_develop=false
case "${1:-}" in
  "") ;;
  --prepare-develop) prepare_develop=true ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean; commit or stash changes before syncing." >&2
  exit 1
fi

for remote in origin upstream; do
  if ! git remote get-url "$remote" >/dev/null 2>&1; then
    echo "Required remote '$remote' is not configured." >&2
    exit 1
  fi
done

origin_url="$(git remote get-url origin)"
if [[ "$origin_url" != *"github.com/zhaomo08/memmy-agent"* ]]; then
  echo "The origin remote does not point to zhaomo08/memmy-agent: $origin_url" >&2
  exit 1
fi

upstream_url="$(git remote get-url upstream)"
if [[ "$upstream_url" != *"github.com/MemTensor/memmy-agent"* ]]; then
  echo "The upstream remote does not point to MemTensor/memmy-agent: $upstream_url" >&2
  exit 1
fi

original_branch="$(git branch --show-current)"
if [[ -z "$original_branch" ]]; then
  echo "Detached HEAD is not supported." >&2
  exit 1
fi

git fetch --prune upstream main
git fetch --prune origin main develop

if ! git show-ref --verify --quiet refs/heads/main; then
  git branch main origin/main
fi

git switch main
git merge --ff-only upstream/main
git push origin main

upstream_sha="$(git rev-parse --short=8 main)"

if [[ "$prepare_develop" == true ]]; then
  if ! git show-ref --verify --quiet refs/remotes/origin/develop; then
    echo "origin/develop does not exist." >&2
    exit 1
  fi

  if git show-ref --verify --quiet refs/heads/develop; then
    git switch develop
    git merge --ff-only origin/develop
  else
    git switch --create develop --track origin/develop
  fi

  sync_branch="sync/upstream-$upstream_sha"
  if git show-ref --verify --quiet "refs/heads/$sync_branch"; then
    echo "Sync branch already exists: $sync_branch" >&2
    exit 1
  fi

  git switch --create "$sync_branch"
  git merge --no-edit main

  echo "Prepared $sync_branch. Run the relevant checks, push it, and open a PR into develop."
elif [[ "$original_branch" != main ]]; then
  git switch "$original_branch"
fi

echo "Fork main is synchronized at $(git rev-parse --short=8 main)."
