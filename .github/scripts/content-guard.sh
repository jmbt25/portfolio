#!/usr/bin/env bash
#
# Identity tripwire. The /thinking agent was removed. This guards its return in
# two ways, because they are two different threats:
#
#   (a) FILENAME regression: an agent-machinery path reappears. Scans tracked
#       PATHS (git ls-files) against two hardcoded lists:
#         EXACT_PATTERNS    matched CASE-SENSITIVELY. One real name each; a case
#                           variant is not a plausible accident, and
#                           case-insensitivity here false-positives on legitimate
#                           content (src/content/skills.md, a docs/agent.md).
#         WORKFLOW_PATTERNS matched CASE-INSENSITIVELY, whole basename. A
#                           copy-paste or a tool regenerating a workflow can
#                           produce Reviewer.yml or SCOUT.yaml, so every
#                           capitalization and .yml/.yaml fails.
#       An empty scout.yml is still caught: the PATH is the regression.
#   (b) CONTENT regression: a disclosure string reappears in prose. git greps the
#       tree (minus this tripwire's own files) for CONTENT_PATTERNS, currently
#       just "private repo".
#
# The lists are ASCII literals below, not loaded from a config file, so there is
# nothing to parse and nothing to malform: CRLF, BOM, whitespace, and a dropped
# trailing newline cannot enter. (a) names the offending path; (b) names the file
# and the pattern, never the surrounding content. It deliberately does not scan
# ADO / Azure DevOps / MBM, which have real homes (the ADO card, the employer
# string).
#
# Exit: 0 clean, 1 a regression (block), 2 an internal error.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Extended regexes over tracked paths, case-SENSITIVE: one real name each.
EXACT_PATTERNS=(
  '^agent/'
  '^functions/'
  '(^|/)scout-prompt\.md$'
  '(^|/)reviewer-prompt\.md$'
  '(^|/)SKILLS\.md$'
  '(^|/)projects-context\.md$'
  '(^|/)sources\.yaml$'
  '(^|/)agent-ci-settings\.json$'
  '(^|/)AGENT\.md$'
)
# Case-INSENSITIVE, whole basename: every capitalization and .yml/.yaml spelling.
WORKFLOW_PATTERNS=(
  '(^|/)scout\.ya?ml$'
  '(^|/)reviewer\.ya?ml$'
)
# Disclosure strings whose threat is the string itself appearing in prose.
CONTENT_PATTERNS=(
  'private repo'
)

fail=0

# ---- (a) filename regression: two scans, different case sensitivity ----
scan_paths() {  # GREPFLAG PATTERN...
  local flag="$1"; shift
  local args=() p rc hits
  for p in "$@"; do args+=(-e "$p"); done
  set +e
  hits="$(git ls-files | grep "$flag" "${args[@]}")"
  rc=$?
  set -e
  case $rc in
    0) echo "tripwire: FAIL agent-machinery path reappeared:" >&2; printf '  %s\n' $hits >&2; fail=1 ;;
    1) : ;;
    *) echo "tripwire: ERROR path scan grep exit $rc" >&2; exit 2 ;;
  esac
}
scan_paths -E  "${EXACT_PATTERNS[@]}"     # case-sensitive
scan_paths -iE "${WORKFLOW_PATTERNS[@]}"  # case-insensitive

# ---- (b) content regression: git grep the tree, per pattern, files-only ----
for pat in "${CONTENT_PATTERNS[@]}"; do
  set +e
  files="$(git grep -lIiE -e "$pat" -- . \
    ':(exclude).github/scripts/content-guard.sh' \
    ':(exclude).github/scripts/tripwire-test.sh')"
  rc=$?
  set -e
  case $rc in
    0) echo "tripwire: FAIL content [pattern=$pat] in: $(echo $files)" >&2; fail=1 ;;
    1) : ;;
    *) echo "tripwire: ERROR content scan git grep exit $rc" >&2; exit 2 ;;
  esac
done

if (( fail )); then echo "tripwire: BLOCKED." >&2; exit 1; fi
echo "tripwire: clean"
exit 0
