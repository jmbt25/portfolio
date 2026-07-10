#!/usr/bin/env bash
#
# Identity tripwire. The /thinking agent was removed, which deleted the class of
# problem it created. This is the insurance that a future commit does not
# reintroduce the removed agent's machinery or an affiliation string that has no
# legitimate home in the tree.
#
# It greps every tracked file (except this script and its term list) for the
# terms in .github/scripts/denylist.txt and fails the build on any hit. A hit is
# by definition a regression: those strings have no valid location here.
#
# It deliberately does NOT grep ADO / Azure DevOps / MBM. Those have real homes
# (the ADO MCP Server project card, the employer string), and a blind grep
# cannot tell a regression from the real thing.
#
# Exit: 0 clean, 1 a forbidden string reappeared, 2 misconfiguration.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
denylist=".github/scripts/denylist.txt"
[[ -f "$denylist" ]] || { echo "tripwire: ERROR denylist not found at $denylist" >&2; exit 2; }
patterns="$(grep -vE '^[[:space:]]*(#|$)' "$denylist" || true)"
[[ -n "$patterns" ]] || { echo "tripwire: ERROR denylist has no patterns" >&2; exit 2; }

# Write patterns to a temp file rather than a process substitution: git grep -f
# cannot read a /proc/fd path under MSYS git on Windows.
pat_file="$(mktemp)"
trap 'rm -f "$pat_file"' EXIT
printf '%s\n' "$patterns" > "$pat_file"
set +e
hits="$(git grep -nIiE -f "$pat_file" -- . \
  ':(exclude).github/scripts/denylist.txt' \
  ':(exclude).github/scripts/content-guard.sh')"
rc=$?
set -e
case $rc in
  0) echo "tripwire: FAIL a removed-agent string reappeared:" >&2; printf '%s\n' "$hits" >&2; exit 1 ;;
  1) echo "tripwire: clean"; exit 0 ;;
  *) echo "tripwire: ERROR git grep exited $rc" >&2; exit 2 ;;
esac
