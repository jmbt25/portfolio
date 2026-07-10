#!/usr/bin/env bash
#
# Content guard for agent-authored content.
#
# INVARIANT: every artifact that leaves this runner is guarded. Exits are:
#   - the staged commit set (what the workflow `git add`s and commits),
#   - the reviewer PR body (published to a public repo, never staged),
#   - the agent's stdout, which lands in a public Actions log.
# Static templates authored by the workflow (PR titles, commit messages) are
# exempt because no agent writes them. .github/scripts/guard-target-test.sh
# fails if a workflow adds an exit this guard does not cover.
#
# HOW IT SCANS:
#   - Dated entries (agent/entries/YYYY-MM-DD.json) go through entry-validate.mjs,
#     which reads the EXACT staged blob in staged mode (not the working tree),
#     enforces the strict schema (unknown key, wrong type, off-host source URL,
#     non-referenceable project all reject), and emits NORMALIZED field values
#     (NFKC + zero-width/control strip). The guard matches those, not raw bytes.
#   - Non-dated files (SCHEMA-EXAMPLE.json, feedback, SKILLS.md, PR body) and the
#     stdout log are normalized through the same function, then matched.
#
# REPORTING: on a hit it prints ONLY the section, the denylist pattern that
# matched, and the logical filename. It NEVER prints the matched content or line,
# for any target.
#
# Denylist sections (agent/denylist.txt), by target:
#   [identity]    all values of entries + all normalized text of other targets
#   [repo-config] same as identity
#   [vocabulary]  entry headline/body values, and the stdout log; never source_*
#
# Usage:
#   content-guard.sh                 scan the staged set
#   content-guard.sh PATH...         scan the staged set PLUS PATH(s)
#   content-guard.sh --stdout LOG    also scan LOG as agent stdout
#   content-guard.sh --working-tree  scan the agent-authored working tree (PR CI)
#
# Exit: 0 clean, 1 denylisted content or schema violation (block), 2 error.

set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
cd "$repo_root"
denylist="agent/denylist.txt"
validator="$script_dir/entry-validate.mjs"
[[ -f "$denylist" ]] || { echo "guard: ERROR denylist not found at $denylist" >&2; exit 2; }
[[ -f "$validator" ]] || { echo "guard: ERROR validator not found at $validator" >&2; exit 2; }

mode="staged"; stdout_log=""; extras=()
while (( $# )); do
  case "$1" in
    --working-tree) mode="working-tree" ;;
    --stdout) shift; stdout_log="${1:-}" ;;
    *) extras+=("$1") ;;
  esac
  shift
done
src="worktree"; [[ "$mode" == "staged" ]] && src="staged"

# ---- enumerate scan files (any enumeration failure is exit 2, never a pass) ----
scan_files=()
if [[ "$mode" == "working-tree" ]]; then
  shopt -s nullglob
  scan_files+=( agent/entries/*.json agent/feedback/*.json )
  shopt -u nullglob
  [[ -f agent/SKILLS.md ]] && scan_files+=( agent/SKILLS.md )
  [[ -f agent/reviewer-pr-body.md ]] && scan_files+=( agent/reviewer-pr-body.md )
else
  if ! staged="$(git diff --cached --name-only)"; then
    echo "guard: ERROR git diff --cached failed" >&2; exit 2
  fi
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    if git cat-file -e ":$f" 2>/dev/null; then scan_files+=( "$f" ); fi  # skip staged deletions
  done <<< "$staged"
fi
for e in "${extras[@]}"; do [[ -f "$e" ]] && scan_files+=( "$e" ); done
# dedup without process substitution
declare -A seen=(); deduped=()
for x in "${scan_files[@]:-}"; do
  [[ -n "$x" ]] || continue
  [[ -n "${seen[$x]:-}" ]] || { deduped+=( "$x" ); seen[$x]=1; }
done
scan_files=( "${deduped[@]:-}" )

if (( ${#scan_files[@]} == 0 )) && [[ -z "$stdout_log" ]]; then
  echo "guard: PASS nothing to scan"; exit 0
fi

# ---- parse denylist sections ----
section=""; identity=(); repoconfig=(); vocabulary=()
while IFS= read -r raw; do
  line="$(printf '%s' "$raw" | sed -e 's/[[:space:]]*#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [[ -z "$line" ]] && continue
  case "$line" in
    '[identity]') section=id; continue ;;
    '[repo-config]') section=rc; continue ;;
    '[vocabulary]') section=voc; continue ;;
  esac
  case "$section" in id) identity+=("$line") ;; rc) repoconfig+=("$line") ;; voc) vocabulary+=("$line") ;; esac
done < "$denylist"

fail=0
# match_section LABEL TEXT FILELABEL PATTERN...   (reports pattern name, never content)
match_section() {
  local label="$1" text="$2" filelabel="$3"; shift 3
  local pat rc
  for pat in "$@"; do
    set +e
    grep -qiE -- "$pat" <<<"$text"
    rc=$?
    set -e
    case $rc in
      0) echo "guard: FAIL [$label] file=$filelabel pattern=$pat" >&2; fail=1 ;;
      1) : ;;
      *) echo "guard: ERROR grep exit $rc scanning $filelabel" >&2; exit 2 ;;
    esac
  done
}

is_dated_entry() { [[ "$1" =~ ^agent/entries/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$ ]]; }

for f in "${scan_files[@]:-}"; do
  [[ -n "$f" ]] || continue
  if is_dated_entry "$f"; then
    err="$(mktemp)"
    set +e
    values="$(node "$validator" --emit-values "--source=$src" "$f" 2>"$err")"
    vrc=$?
    set -e
    if [[ $vrc -eq 1 ]]; then
      echo "guard: FAIL entry schema: $(cat "$err")" >&2   # validator never echoes the value
      rm -f "$err"; fail=1; continue
    elif [[ $vrc -ne 0 ]]; then
      echo "guard: ERROR validator failed on $f: $(cat "$err")" >&2; rm -f "$err"; exit 2
    fi
    rm -f "$err"
    allv="$(cut -f2- <<<"$values")"
    vocv="$(awk -F'\t' '$1=="headline"||$1=="body"{print $2}' <<<"$values")"
    match_section identity    "$allv" "$f" "${identity[@]}"
    match_section repo-config "$allv" "$f" "${repoconfig[@]}"
    match_section vocabulary  "$vocv" "$f" "${vocabulary[@]}"
  else
    set +e
    text="$(node "$validator" --normalize "--source=$src" "$f")"
    nrc=$?
    set -e
    [[ $nrc -eq 0 ]] || { echo "guard: ERROR normalize failed on $f" >&2; exit 2; }
    match_section identity    "$text" "$f" "${identity[@]}"
    match_section repo-config "$text" "$f" "${repoconfig[@]}"
  fi
done

if [[ -n "$stdout_log" ]]; then
  [[ -f "$stdout_log" ]] || { echo "guard: ERROR --stdout log not found: $stdout_log" >&2; exit 2; }
  set +e
  text="$(node "$validator" --normalize --source=worktree "$stdout_log")"
  nrc=$?
  set -e
  [[ $nrc -eq 0 ]] || { echo "guard: ERROR normalize failed on stdout log" >&2; exit 2; }
  match_section identity    "$text" "agent-stdout" "${identity[@]}"
  match_section repo-config "$text" "agent-stdout" "${repoconfig[@]}"
  match_section vocabulary  "$text" "agent-stdout" "${vocabulary[@]}"
fi

if (( fail )); then echo "guard: BLOCKED. Do not commit, deploy, or print." >&2; exit 1; fi
echo "guard: PASS"
exit 0
