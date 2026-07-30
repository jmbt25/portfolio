#!/usr/bin/env bash
#
# Identity boundary guard.
#
# Fails if any denied term appears in the built output. The denied terms live in
# an untracked local file rather than in this script, because committing them
# would put them in git history permanently, which is the exact outcome the
# guard exists to prevent.
#
# Usage:
#   bash scripts/check-identity.sh [dist-dir]
#
# Terms are read from, in order of precedence:
#   1. IDENTITY_DENYLIST, a newline separated list in the environment
#   2. scripts/.identity-denylist, one term per line
#
# Blank lines and anything after a # are ignored. Matching is case insensitive
# and literal, not regex, so terms containing dots behave as written.
#
# Exits nonzero when a denied term is found, when no denylist is available, or
# when the build output is missing. It fails closed on purpose: a guard that
# passes when it could not actually run is worse than no guard, because it
# reports green.
#
# On failure this prints the offending file paths but never the term itself,
# so a denied string cannot leak into CI logs.
#
# See D4 in docs/baseline/DECISIONS.md.

set -uo pipefail

DIST="${1:-dist}"
DENYLIST_FILE="${IDENTITY_DENYLIST_FILE:-scripts/.identity-denylist}"

fail() {
  printf 'check-identity: FAIL: %s\n' "$1" >&2
  exit 1
}

[ -d "$DIST" ] || fail "build output not found at '$DIST'. Run the build first."

if [ -n "${IDENTITY_DENYLIST:-}" ]; then
  raw="$IDENTITY_DENYLIST"
  source_desc="IDENTITY_DENYLIST environment variable"
elif [ -f "$DENYLIST_FILE" ]; then
  raw="$(cat "$DENYLIST_FILE")"
  source_desc="$DENYLIST_FILE"
else
  fail "no denylist found. Create '$DENYLIST_FILE' with one term per line, or set IDENTITY_DENYLIST. That file is gitignored on purpose, see D4."
fi

terms="$(printf '%s\n' "$raw" | sed 's/#.*//' | sed 's/[[:space:]]*$//' | grep -v '^[[:space:]]*$')"
[ -n "$terms" ] || fail "denylist from $source_desc contains no usable terms."

count="$(printf '%s\n' "$terms" | wc -l | tr -d '[:space:]')"
printf 'check-identity: scanning %s against %s term(s) from %s\n' "$DIST" "$count" "$source_desc"

hits=0
while IFS= read -r term; do
  [ -n "$term" ] || continue
  matches="$(grep -ril -F -- "$term" "$DIST" 2>/dev/null)"
  if [ -n "$matches" ]; then
    printf 'check-identity: denied term present in:\n' >&2
    printf '%s\n' "$matches" | sed 's/^/  /' >&2
    hits=$((hits + 1))
  fi
done <<TERMS
$terms
TERMS

[ "$hits" -eq 0 ] || fail "$hits denied term(s) present in build output."

printf 'check-identity: PASS, no denied terms in %s\n' "$DIST"
