#!/usr/bin/env bash
# Creates / updates the labels (type, priority, blocked, and the status:* stages — #283).
set -euo pipefail

label() { gh label create "$1" --color "$2" --description "$3" --force; }

# GitHub's default labels duplicate type:* — remove them (templates do not copy labels).
for default in bug documentation duplicate enhancement "good first issue" "help wanted" \
  invalid question wontfix accessibility; do
  gh label delete "$default" --yes >/dev/null 2>&1 || true
done

label "type:feature"       "1d76db" "New behaviour"
label "type:bugfix"        "d73a4a" "Wrong behaviour fixed"
label "type:epic"          "5319e7" "Parent issue with sub-issues"
label "type:chore"         "cfd3d7" "Tooling, config, refactor"
label "prio:mvp"           "0e8a16" "Must have"
label "prio:stretch"       "c2e0c6" "Nice to have"
label "blocked"            "b60205" "Cannot proceed, see comment"

"$(dirname "$0")/ticket.sh" setup
