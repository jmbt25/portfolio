#!/usr/bin/env bash
#
# Identity tripwire. The /thinking agent was removed. This guards its return in
# two ways, because they are two different threats:
#
#   (a) FILENAME regression: an agent-machinery path reappears. Scans tracked
#       PATHS (git ls-files) against .github/scripts/forbidden-paths.txt. An
#       empty scout.yml that mentions nothing is still caught: the PATH is the
#       regression, not the content.
#   (b) CONTENT regression: a disclosure string reappears in prose. git greps the
#       tree (minus this tripwire's own files) for the terms in
#       .github/scripts/denylist.txt, currently just "private repo".
#
# Both fail closed. (a) names the offending path; (b) names the file and the
# pattern, never the surrounding content. It deliberately does not scan ADO /
# Azure DevOps / MBM, which have real homes (the ADO card, the employer string).
#
# Exit: 0 clean, 1 a regression (block), 2 misconfiguration.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
paths_file=".github/scripts/forbidden-paths.txt"
deny_file=".github/scripts/denylist.txt"

# Load non-comment patterns, failing closed: grep 0 = patterns present, 1 = the
# list is empty (misconfiguration), anything else = a read error. A partial read
# that errors must not proceed on an incomplete list.
load_patterns() {
  local f="$1" out rc
  [[ -f "$f" ]] || { echo "tripwire: ERROR $f not found" >&2; exit 2; }
  set +e
  out="$(grep -vE '^[[:space:]]*(#|$)' "$f")"
  rc=$?
  set -e
  case $rc in
    0) printf '%s\n' "$out" ;;
    1) echo "tripwire: ERROR $f has no usable patterns (misconfiguration)" >&2; exit 2 ;;
    *) echo "tripwire: ERROR reading $f (grep exit $rc)" >&2; exit 2 ;;
  esac
}

fail=0

# ---- (a) filename regression: scan tracked PATHS ----
path_patterns="$(load_patterns "$paths_file")"
ppf="$(mktemp)"; printf '%s\n' "$path_patterns" > "$ppf"
set +e
bad_paths="$(git ls-files | grep -E -f "$ppf")"
rc=$?
set -e
rm -f "$ppf"
case $rc in
  0) echo "tripwire: FAIL agent-machinery path reappeared:" >&2; printf '  %s\n' $bad_paths >&2; fail=1 ;;
  1) : ;;
  *) echo "tripwire: ERROR path scan grep exit $rc" >&2; exit 2 ;;
esac

# ---- (b) content regression: git grep the tree, per pattern, files-only ----
content_patterns="$(load_patterns "$deny_file")"
while IFS= read -r pat; do
  [[ -z "$pat" ]] && continue
  set +e
  files="$(git grep -lIiE -e "$pat" -- . \
    ':(exclude).github/scripts/denylist.txt' \
    ':(exclude).github/scripts/content-guard.sh')"
  rc=$?
  set -e
  case $rc in
    0) echo "tripwire: FAIL content [pattern=$pat] in: $(echo $files)" >&2; fail=1 ;;
    1) : ;;
    *) echo "tripwire: ERROR content scan git grep exit $rc" >&2; exit 2 ;;
  esac
done <<< "$content_patterns"

if (( fail )); then echo "tripwire: BLOCKED." >&2; exit 1; fi
echo "tripwire: clean"
exit 0
