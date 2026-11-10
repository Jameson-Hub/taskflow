#!/usr/bin/env bash
# Fails if any commit in the given range breaks the Conventional Commits format.
# Usage: scripts/check-commits.sh <base-sha> <head-sha>
set -euo pipefail

base="$1"
head="$2"
pattern='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: [^ ].{0,71}$'

# A new branch has no "before" commit; check just the head.
if [[ "$base" =~ ^0+$ ]]; then range="$head^!"; else range="$base..$head"; fi

status=0
while IFS= read -r sha; do
  subject=$(git log -1 --format=%s "$sha")
  if ! [[ "$subject" =~ $pattern ]]; then
    echo "✗ ${sha:0:7} \"$subject\""
    status=1
  fi
  if git log -1 --format=%B "$sha" | grep -qi '^co-authored-by:'; then
    echo "✗ ${sha:0:7} has a Co-Authored-By trailer"
    status=1
  fi
done < <(git rev-list --no-merges "$range")

if [[ $status -ne 0 ]]; then
  echo
  echo "Commit subjects must look like: type(scope): summary   (max 72 chars)"
  echo "Types: feat fix docs style refactor perf test build ci chore revert"
fi
exit $status
