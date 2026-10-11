#!/usr/bin/env bash
# One-time: local git + GitHub repo with main as the only integration branch and default, labels, Wiki.
# Usage: scripts/bootstrap-repo.sh [--public|--private]   (default: --public — branch protection
# and wiki on a free plan need a public repo)
set -euo pipefail

VISIBILITY="${1:---public}"
NAME="$(basename "$(pwd)")"

[[ -f package-lock.json ]] || { echo "Run 'make setup' first (package-lock.json is needed for CI)"; exit 1; }

git init -b main
git add -A
git commit -m "chore: bootstrap ${NAME}"

gh repo create "${NAME}" "${VISIBILITY}" --source . --remote origin
git push -u origin main
gh repo edit --default-branch main --template --enable-wiki --enable-issues

"$(dirname "$0")/bootstrap-labels.sh"
"$(dirname "$0")/ticket.sh" setup

# Docs → GitHub Wiki (from ../<name>.wiki if present)
if [[ -d "../${NAME}.wiki" ]]; then
  "$(dirname "$0")/wiki.sh" publish "docs: initial wiki" || true
fi
echo "Done: ${NAME} — main (default), issues + wiki enabled"
