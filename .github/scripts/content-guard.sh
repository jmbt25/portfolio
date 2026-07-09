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
# fails if any workflow adds an exit this guard does not cover.
#
# Usage:
#   content-guard.sh                 scan the staged set (git diff --cached)
#   content-guard.sh PATH...         scan the staged set PLUS PATH(s); reviewer
#                                    passes agent/reviewer-pr-body.md
#   content-guard.sh --stdout LOG    also scan LOG as agent stdout: all sections,
#                                    and on a hit report only the section name,
#                                    never the matched line (it would re-leak)
#   content-guard.sh --working-tree  scan the agent-authored working tree (PR CI)
#
# Denylist sections (agent/denylist.txt), applied per file:
#   [identity]    every scanned file
#   [repo-config] every scanned file (SKILLS.md and the PR body are kept clean of
#                 repo-config names on purpose; there is no exemption)
#   [vocabulary]  the agent-authored fields (headline, body) of entries, and the
#                 whole agent stdout log; never the cited source_* fields
#
# Exit: 0 clean, 1 denylisted content found (block), 2 misconfiguration.

set -uo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
cd "$repo_root"
denylist="agent/denylist.txt"
fields_helper="$script_dir/agent-fields.mjs"
[[ -f "$denylist" ]] || { echo "guard: ERROR denylist not found at $denylist" >&2; exit 2; }
[[ -f "$fields_helper" ]] || { echo "guard: ERROR field helper not found at $fields_helper" >&2; exit 2; }

mode="staged"; stdout_log=""; extras=()
while (( $# )); do
  case "$1" in
    --working-tree) mode="working-tree" ;;
    --stdout) shift; stdout_log="${1:-}" ;;
    *) extras+=("$1") ;;
  esac
  shift
done

scan_files=()
if [[ "$mode" == "working-tree" ]]; then
  shopt -s nullglob
  scan_files+=( agent/entries/*.json agent/feedback/*.json )
  shopt -u nullglob
  [[ -f agent/SKILLS.md ]] && scan_files+=( agent/SKILLS.md )
  [[ -f agent/reviewer-pr-body.md ]] && scan_files+=( agent/reviewer-pr-body.md )
else
  while IFS= read -r f; do
    [[ -n "$f" && -f "$f" ]] && scan_files+=( "$f" )
  done < <(git diff --cached --name-only)
fi
for e in "${extras[@]}"; do [[ -f "$e" ]] && scan_files+=( "$e" ); done
if (( ${#scan_files[@]} )); then
  mapfile -t scan_files < <(printf '%s\n' "${scan_files[@]}" | awk 'NF && !seen[$0]++')
fi

if (( ${#scan_files[@]} == 0 )) && [[ -z "$stdout_log" ]]; then
  echo "guard: PASS nothing to scan"
  exit 0
fi

# --- parse denylist sections ---
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
id_pat="$(printf '%s\n' "${identity[@]}")"
rc_pat="$(printf '%s\n' "${repoconfig[@]}")"
voc_pat="$(printf '%s\n' "${vocabulary[@]}")"

fail=0
# grep_file PATTERNS FILE LABEL QUIET   (QUIET=1 reports section only, no lines)
grep_file() {
  local patterns="$1" file="$2" label="$3" quiet="$4" hits
  [[ -z "$patterns" ]] && return 0
  hits="$(printf '%s\n' "$patterns" | grep -iEnHf - "$file" 2>/dev/null)"
  if [[ -n "$hits" ]]; then
    if [[ "$quiet" == "1" ]]; then
      echo "guard: FAIL [$label] in $file (content withheld)" >&2
    else
      echo "guard: FAIL [$label] in $file" >&2
      printf '%s\n' "$hits" >&2
    fi
    fail=1
  fi
}
voc_fields() { # FILE  (vocabulary over headline/body only, field-scoped)
  local file="$1" fields vh
  [[ -z "$voc_pat" ]] && return 0
  fields="$(node "$fields_helper" "$file" 2>/dev/null)" || { echo "guard: ERROR field extraction failed on $file" >&2; exit 2; }
  [[ -z "$fields" ]] && return 0
  vh="$(printf '%s\n' "$fields" | grep -iEf <(printf '%s\n' "$voc_pat") 2>/dev/null)"
  [[ -n "$vh" ]] && { echo "guard: FAIL [vocabulary] in $file (headline/body)" >&2; printf '%s\n' "$vh" >&2; fail=1; }
}

for f in "${scan_files[@]}"; do
  grep_file "$id_pat" "$f" identity 0
  grep_file "$rc_pat" "$f" repo-config 0
  case "$f" in
    agent/entries/*.json) voc_fields "$f" ;;   # vocabulary is field-scoped for entries
  esac
done

# agent stdout: all sections, flat, quiet reporting (never re-print the content)
if [[ -n "$stdout_log" ]]; then
  if [[ -f "$stdout_log" ]]; then
    grep_file "$id_pat"  "$stdout_log" identity 1
    grep_file "$rc_pat"  "$stdout_log" repo-config 1
    grep_file "$voc_pat" "$stdout_log" vocabulary 1
  else
    echo "guard: ERROR --stdout log not found: $stdout_log" >&2; exit 2
  fi
fi

if (( fail )); then echo "guard: BLOCKED. Do not commit, deploy, or print." >&2; exit 1; fi
echo "guard: PASS"
exit 0
