#!/usr/bin/env bash
# Ticket stage = its `status:*` label (repository REST endpoints only — no GraphQL, no Projects board:
# cloud sessions reach repository-scoped APIs only, #283).
# Conveyor: Triage → Backlog → In progress → Test → Done (Done only by a human: close the issue).
#
#   scripts/ticket.sh setup                    create / update the status labels
#   scripts/ticket.sh status <issue> <Status>  move an issue: Triage | Backlog | "In progress" | Test
#   scripts/ticket.sh list <Status>            open issues in a stage
#   scripts/ticket.sh sub <parent> <child>     make <child> a sub-issue of <parent>
set -euo pipefail

STATUSES=("Triage" "Backlog" "In progress" "Test")
REPO_FULL="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null ||
  git remote get-url origin | sed -E 's#(https://github.com/|git@github.com:)##; s#\.git$##')"

die() { echo "$*" >&2; exit 1; }
valid_status() {
  [[ "$1" == "Done" ]] && die "Done is a human's call: close the issue when it is accepted."
  local s; for s in "${STATUSES[@]}"; do [[ "$s" == "$1" ]] && return 0; done
  die "Unknown status '$1'. Use one of: ${STATUSES[*]}"
}
label_of() { echo "status:$(tr '[:upper:] ' '[:lower:]-' <<<"$1")"; }

case "${1:-}" in
  setup)
    upsert() {
      gh api -X POST "repos/${REPO_FULL}/labels" -f name="$1" -f color="$2" -f description="$3" >/dev/null 2>&1 ||
        gh api -X PATCH "repos/${REPO_FULL}/labels/$1" -f color="$2" -f description="$3" >/dev/null
    }
    upsert "status:triage" "bfbfbf" "Business side clarified (triage skill)"
    upsert "status:backlog" "0052cc" "Spec, plan and acceptance checks ready (spec-session skill)"
    upsert "status:in-progress" "fbca04" "Being implemented (implement skill)"
    upsert "status:test" "8250df" "Merged to main, waiting for manual acceptance"
    echo "status labels: triage → backlog → in-progress → test (Done: close the issue)"
    ;;
  status)
    ISSUE="${2:?issue number required}"; STATUS="${3:?status required}"
    valid_status "${STATUS}"
    WANTED="$(label_of "${STATUS}")"
    for current in $(gh api "repos/${REPO_FULL}/issues/${ISSUE}/labels" --jq '.[].name | select(startswith("status:"))'); do
      [[ "${current}" == "${WANTED}" ]] || gh api -X DELETE "repos/${REPO_FULL}/issues/${ISSUE}/labels/${current}" >/dev/null
    done
    gh api -X POST "repos/${REPO_FULL}/issues/${ISSUE}/labels" -f "labels[]=${WANTED}" >/dev/null
    echo "#${ISSUE} → ${STATUS}"
    ;;
  list)
    STATUS="${2:?status required}"; valid_status "${STATUS}"
    gh api --paginate "repos/${REPO_FULL}/issues?state=open&labels=$(label_of "${STATUS}")&per_page=100" \
      --jq '.[] | select(.pull_request == null) | "#\(.number) \(.title)"'
    ;;
  sub)
    PARENT="${2:?parent issue required}"; CHILD="${3:?child issue required}"
    CHILD_ID="$(gh api "repos/${REPO_FULL}/issues/${CHILD}" --jq .id)"
    gh api -X POST "repos/${REPO_FULL}/issues/${PARENT}/sub_issues" -F sub_issue_id="${CHILD_ID}" >/dev/null
    echo "#${CHILD} is a sub-issue of #${PARENT}"
    ;;
  *)
    sed -n '2,10p' "$0"; exit 1
    ;;
esac
