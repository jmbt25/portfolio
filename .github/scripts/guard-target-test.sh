#!/usr/bin/env bash
#
# Exit-coverage test for the content guard.
#
# Every artifact that leaves the runner must be guarded (see the INVARIANT in
# content-guard.sh). For each workflow that runs the agent, this enumerates the
# exits and fails if any is unguarded:
#   E1  the agent's stdout is redirected to a *.log AND that log is passed to
#       content-guard.sh --stdout (it lands in a public Actions log).
#   E2  a content-guard.sh runs before any `git commit` (guards the staged set).
#   E3  every `gh pr create --body-file FILE` has FILE passed to content-guard.sh
#       (the PR body is published but never staged).
#
# This is the test that catches the next exit someone adds without guarding it.
# Exit: 0 all exits covered, 1 an exit is unguarded, 2 misconfiguration.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

fail=0; checked=0
for wf in .github/workflows/*.yml; do
  grep -q 'permission-mode dontAsk' "$wf" || continue   # only agent workflows
  checked=$((checked+1))
  name="$(basename "$wf")"

  # E1: stdout redirected to a log, and that log guarded via --stdout
  logfile="$(grep -oE '>[[:space:]]*[A-Za-z0-9_./-]+\.log' "$wf" | head -1 | sed -E 's/^>[[:space:]]*//')"
  if [[ -z "$logfile" ]]; then
    echo "  FAIL $name: agent stdout is not redirected to a *.log (unguarded public-log exit)" >&2; fail=1
  elif ! grep -E 'content-guard\.sh' "$wf" | grep -qF -- "--stdout $logfile"; then
    echo "  FAIL $name: $logfile is not passed to content-guard.sh --stdout" >&2; fail=1
  else
    echo "  OK   $name: agent stdout ($logfile) is guarded"
  fi

  # E2: a content guard runs before the first git commit
  commit_line="$(grep -nE 'git( -c [^ ]+)* +commit' "$wf" | head -1 | cut -d: -f1)"
  guard_line="$(grep -nE 'content-guard\.sh' "$wf" | head -1 | cut -d: -f1)"
  if [[ -n "$commit_line" ]]; then
    if [[ -z "$guard_line" || "$guard_line" -ge "$commit_line" ]]; then
      echo "  FAIL $name: git commit (line $commit_line) is not preceded by a content guard" >&2; fail=1
    else
      echo "  OK   $name: staged set guarded before commit"
    fi
  fi

  # E3: every --body-file FILE must appear on a content-guard.sh line
  while IFS= read -r bf; do
    [[ -z "$bf" ]] && continue
    if grep -E 'content-guard\.sh' "$wf" | grep -qF -- "$bf"; then
      echo "  OK   $name: PR body $bf is guarded"
    else
      echo "  FAIL $name: PR body $bf is published but not passed to content-guard.sh" >&2; fail=1
    fi
  done < <(grep -oE -- '--body-file[[:space:]]+[A-Za-z0-9_./-]+' "$wf" | awk '{print $2}')
done

(( checked )) || { echo "guard-target-test: ERROR found no agent workflows" >&2; exit 2; }
(( fail )) && { echo "guard-target-test: an exit is unguarded" >&2; exit 1; }
echo "guard-target-test: OK, every runner exit is guarded"
exit 0
