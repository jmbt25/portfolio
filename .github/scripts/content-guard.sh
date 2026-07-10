#!/usr/bin/env bash
#
# Identity tripwire. The /thinking agent was removed. This guards its return in
# two ways, because they are two different threats:
#
#   (a) FILENAME regression: an agent-machinery path reappears. Scans tracked
#       PATHS (git ls-files) against .github/scripts/forbidden-paths.txt, which
#       has two groups:
#         [exact]    matched CASE-SENSITIVELY. One real name each; a case variant
#                    is not a plausible accident, and case-insensitivity here
#                    false-positives on legitimate content (src/content/skills.md,
#                    a docs/agent.md).
#         [workflow] matched CASE-INSENSITIVELY, whole basename. A copy-paste or a
#                    tool regenerating a workflow can produce Reviewer.yml or
#                    SCOUT.yaml, so every capitalization and .yml/.yaml fails.
#       An empty scout.yml is still caught: the PATH is the regression.
#   (b) CONTENT regression: a disclosure string reappears in prose. git greps the
#       tree (minus this tripwire's own files) for the terms in denylist.txt,
#       currently just "private repo".
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

# Load non-comment patterns from a flat file, failing closed: grep 0 = present,
# 1 = empty list (misconfiguration), anything else = a read error.
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

# ---- (a) filename regression: two groups, different case sensitivity ----
exact_patterns=""; workflow_patterns=""; seen_exact=""; seen_workflow=""
[[ -f "$paths_file" ]] || { echo "tripwire: ERROR $paths_file not found" >&2; exit 2; }
section=""
while IFS= read -r line; do
  line="${line%%#*}"
  line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [[ -z "$line" ]] && continue
  case "$line" in
    '[exact]')
      [[ -n "$seen_exact" ]] && { echo "tripwire: ERROR $paths_file: duplicate [exact] section" >&2; exit 2; }
      seen_exact=1; section=exact; continue ;;
    '[workflow]')
      [[ -n "$seen_workflow" ]] && { echo "tripwire: ERROR $paths_file: duplicate [workflow] section" >&2; exit 2; }
      seen_workflow=1; section=workflow; continue ;;
    \[*\])  # any other bracketed line is a header, and no other header is valid
      echo "tripwire: ERROR $paths_file: unknown section header: $line" >&2; exit 2 ;;
  esac
  case "$section" in
    exact)    exact_patterns+="$line"$'\n' ;;
    workflow) workflow_patterns+="$line"$'\n' ;;
    *) echo "tripwire: ERROR $paths_file: pattern outside a section: $line" >&2; exit 2 ;;
  esac
done < "$paths_file"
# Both sections must exist AND hold a pattern. An emptied section is a broken
# guard that silently stops scanning its half, not a pass.
[[ -n "$seen_exact" ]]        || { echo "tripwire: ERROR $paths_file: [exact] section missing" >&2; exit 2; }
[[ -n "$seen_workflow" ]]     || { echo "tripwire: ERROR $paths_file: [workflow] section missing" >&2; exit 2; }
[[ -n "$exact_patterns" ]]    || { echo "tripwire: ERROR $paths_file: [exact] section is empty" >&2; exit 2; }
[[ -n "$workflow_patterns" ]] || { echo "tripwire: ERROR $paths_file: [workflow] section is empty" >&2; exit 2; }

scan_paths() {  # PATTERNS GREPFLAGS
  local patterns="$1" flags="$2" pf rc hits
  [[ -z "$patterns" ]] && return 0
  pf="$(mktemp)"; printf '%s' "$patterns" > "$pf"
  set +e
  hits="$(git ls-files | grep $flags -f "$pf")"
  rc=$?
  set -e
  rm -f "$pf"
  case $rc in
    0) echo "tripwire: FAIL agent-machinery path reappeared:" >&2; printf '  %s\n' $hits >&2; fail=1 ;;
    1) : ;;
    *) echo "tripwire: ERROR path scan grep exit $rc" >&2; exit 2 ;;
  esac
}
scan_paths "$exact_patterns"    "-E"    # case-sensitive
scan_paths "$workflow_patterns" "-iE"   # case-insensitive

# ---- (b) content regression: git grep the tree, per pattern, files-only ----
content_patterns="$(load_patterns "$deny_file")"
while IFS= read -r pat; do
  [[ -z "$pat" ]] && continue
  set +e
  files="$(git grep -lIiE -e "$pat" -- . \
    ':(exclude).github/scripts/denylist.txt' \
    ':(exclude).github/scripts/forbidden-paths.txt' \
    ':(exclude).github/scripts/content-guard.sh' \
    ':(exclude).github/scripts/tripwire-test.sh')"
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
