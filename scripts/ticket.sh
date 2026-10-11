#!/usr/bin/env bash
# Ticket stage = field "Status" of the GitHub Project (board) named after the repo.
# Conveyor: Triage → Backlog → In progress → Test → Done (Done only by a human).
#
#   scripts/ticket.sh setup                    create/link the board, set the Status columns
#   scripts/ticket.sh status <issue> <Status>  move an issue: Triage | Backlog | "In progress" | Test | Done
#   scripts/ticket.sh list <Status>            issues in a column
#   scripts/ticket.sh sub <parent> <child>     make <child> a sub-issue of <parent>
set -euo pipefail

STATUSES=("Triage" "Backlog" "In progress" "Test" "Done")
REPO_FULL="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
OWNER="${REPO_FULL%/*}"
REPO="${REPO_FULL#*/}"

die() { echo "$*" >&2; exit 1; }
project_number() {
  gh project list --owner "${OWNER}" --format json \
    --jq ".projects[] | select(.title==\"${REPO}\") | .number" | head -1
}
require_project() {
  PNUM="$(project_number)"
  [[ -n "${PNUM}" ]] || die "No board yet — run: scripts/ticket.sh setup"
}
valid_status() {
  local s; for s in "${STATUSES[@]}"; do [[ "$s" == "$1" ]] && return 0; done
  die "Unknown status '$1'. Use one of: ${STATUSES[*]}"
}

case "${1:-}" in
  setup)
    PNUM="$(project_number)"
    [[ -n "${PNUM}" ]] || PNUM="$(gh project create --owner "${OWNER}" --title "${REPO}" --format json --jq .number)"
    gh project link "${PNUM}" --owner "${OWNER}" --repo "${REPO_FULL}" >/dev/null 2>&1 || true
    FIELD_ID="$(gh project field-list "${PNUM}" --owner "${OWNER}" --format json \
      --jq '.fields[] | select(.name=="Status") | .id')"
    gh api graphql -f fieldId="${FIELD_ID}" -f query='
      mutation($fieldId: ID!) {
        updateProjectV2Field(input: { fieldId: $fieldId, singleSelectOptions: [
          { name: "Triage",      color: GRAY,   description: "Business side clarified (triage skill)" },
          { name: "Backlog",     color: BLUE,   description: "Spec, plan and acceptance criteria ready (spec-session skill)" },
          { name: "In progress", color: YELLOW, description: "Being implemented (implement skill)" },
          { name: "Test",        color: PURPLE, description: "Merged to main, waiting for manual acceptance" },
          { name: "Done",        color: GREEN,  description: "Accepted by a human — set manually only" }
        ]}) { projectV2Field { ... on ProjectV2SingleSelectField { options { name } } } }
      }' --jq '[.data.updateProjectV2Field.projectV2Field.options[].name] | join(" → ")'
    echo "Board: https://github.com/users/${OWNER}/projects/${PNUM}"
    ;;
  status)
    ISSUE="${2:?issue number required}"; STATUS="${3:?status required}"
    valid_status "${STATUS}"; require_project
    PROJECT_ID="$(gh project view "${PNUM}" --owner "${OWNER}" --format json --jq .id)"
    FIELDS="$(gh project field-list "${PNUM}" --owner "${OWNER}" --format json)"
    FIELD_ID="$(jq -r '.fields[] | select(.name=="Status") | .id' <<<"${FIELDS}")"
    OPTION_ID="$(jq -r --arg s "${STATUS}" '.fields[] | select(.name=="Status") | .options[] | select(.name==$s) | .id' <<<"${FIELDS}")"
    ITEM_ID="$(gh project item-add "${PNUM}" --owner "${OWNER}" \
      --url "https://github.com/${REPO_FULL}/issues/${ISSUE}" --format json --jq .id)"
    gh project item-edit --id "${ITEM_ID}" --project-id "${PROJECT_ID}" \
      --field-id "${FIELD_ID}" --single-select-option-id "${OPTION_ID}" >/dev/null
    echo "#${ISSUE} → ${STATUS}"
    ;;
  list)
    STATUS="${2:?status required}"; valid_status "${STATUS}"; require_project
    gh project item-list "${PNUM}" --owner "${OWNER}" --limit 500 --format json |
      jq -r --arg s "${STATUS}" '.items[] | select(.status==$s and .content.type=="Issue") | "#\(.content.number) \(.content.title)"'
    ;;
  sub)
    PARENT="${2:?parent issue required}"; CHILD="${3:?child issue required}"
    CHILD_ID="$(gh api "repos/${REPO_FULL}/issues/${CHILD}" --jq .id)"
    gh api -X POST "repos/${REPO_FULL}/issues/${PARENT}/sub_issues" -F sub_issue_id="${CHILD_ID}" >/dev/null
    echo "#${CHILD} is a sub-issue of #${PARENT}"
    ;;
  *)
    sed -n '2,9p' "$0"; exit 1
    ;;
esac
